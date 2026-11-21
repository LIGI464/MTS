import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CoordinatorList, ImportApplyRequest, ImportApplyResult, MutationResult, Notice, Snapshot } from "@mts/contracts";
import { buildGroups, diffNotices } from "../domain/index.js";
import { MutationError, planMutation, type ItsmCommand } from "../itsm/mutation.js";
import type { DashboardRuntime, DashboardRuntimeOptions } from "../runtime-contract.js";
import { openDashboardStore } from "../store/index.js";
import type { PendingMutation } from "../store/mutations.js";
import { createCoordinatorProjection, inferCoordinatorDirectory, projectCoordinators, readCoordinatorDirectory } from "./coordinators.js";
import { atomicWrite, isMissingFile } from "./file.js";
import { createImportPreviews } from "./import.js";
import { InvalidIncidentFile, LIVE_FILENAME, fingerprint, normalizeIncidents, sha256, type NormalizedIncidents } from "./input.js";

type LiveFile = { bytes: Buffer; digest: string } | { bytes: null; digest: null };

function requestIdConflict(): MutationError {
  return new MutationError(409, "REQUEST_ID_CONFLICT", "Этот requestId уже использован для другого действия.");
}

function revisionConflict(): MutationError {
  return new MutationError(409, "REVISION_CONFLICT", "Набор изменился. Выполните предпросмотр заново.");
}

export async function createDashboardRuntime(options: DashboardRuntimeOptions): Promise<DashboardRuntime> {
  await mkdir(options.dataDir, { recursive: true });
  const configuredDirectory = await readCoordinatorDirectory(options.dataDir);
  const livePath = join(options.dataDir, LIVE_FILENAME);
  const projectCoordinator = createCoordinatorProjection(configuredDirectory ?? []);
  const store = openDashboardStore(join(options.dataDir, "dashboard.sqlite"), projectCoordinator);
  const listeners = new Set<(snapshot: Snapshot) => void>();
  const importPreviews = createImportPreviews();

  let persisted: ReturnType<typeof store.load>;
  let coordinators: CoordinatorList;
  try {
    persisted = store.load();
    coordinators = configuredDirectory ?? inferCoordinatorDirectory(store.getPresentRaw().values());
  } catch (error) {
    store.close();
    throw error;
  }

  const now = () => new Date().toISOString();
  let descriptions = new Map(persisted?.descriptions);
  let snapshot: Snapshot = {
    apiVersion: 1,
    revision: persisted?.revision ?? 0,
    serverNow: now(),
    source: { status: persisted ? "stale" : "unavailable", lastGoodAt: persisted?.lastGoodAt ?? null },
    capabilities: { ...options.capabilities },
    incidents: persisted?.incidents ?? [],
    groups: buildGroups(persisted?.incidents ?? []),
    notices: persisted?.notices ?? [],
  };
  let pendingDigest: string | undefined;
  let acceptedDigest: string | undefined;
  let failedResetDigest: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let tail = Promise.resolve();

  function getSnapshot(): Snapshot {
    return { ...snapshot, serverNow: now() };
  }

  function publish(): void {
    for (const listener of listeners) {
      try {
        listener(getSnapshot());
      } catch {
        // A disconnected subscriber cannot interrupt a committed source update.
      }
    }
  }

  function markSourceFailed(): void {
    const status = snapshot.source.lastGoodAt === null ? "unavailable" : "stale";
    if (snapshot.source.status === status) return;
    snapshot = { ...snapshot, source: { ...snapshot.source, status } };
    publish();
  }

  function accept(
    source: NormalizedIncidents,
    digest: string,
    { reset = false, mutation, importRequestId }: { reset?: boolean; mutation?: PendingMutation; importRequestId?: string } = {},
  ) {
    const directory = configuredDirectory ?? inferCoordinatorDirectory(source.records.map(({ raw }) => raw));
    const data = projectCoordinators(source, projectCoordinator);
    const dashboardChanged = snapshot.source.lastGoodAt === null
      || data.incidents.length !== snapshot.incidents.length
      || data.incidents.some((incident, index) => incident.version !== snapshot.incidents[index].version);
    const at = now();
    const groups = buildGroups(data.incidents);
    const events: Omit<Notice, "seq">[] = reset
      ? [{ kind: "demo.reset", incidentId: null, title: null, at }]
      : diffNotices(snapshot.source.lastGoodAt === null ? null : snapshot, { groups, incidents: data.incidents }, at);
    const saved = store.save({ ...data, revision: snapshot.revision, lastGoodAt: at }, events, {
      dashboardChanged,
      refreshSource: snapshot.source.status !== "ok",
      reset,
      mutation,
      importRequestId,
    });
    acceptedDigest = digest;
    coordinators = directory;
    if (!saved) return;

    const { revision, notices } = saved;
    descriptions = new Map(data.descriptions);
    snapshot = { ...snapshot, revision, notices, incidents: data.incidents, groups, source: { status: "ok", lastGoodAt: at } };
    publish();
    return saved;
  }

  function acceptCurrent(data: NormalizedIncidents, digest: string): void {
    const pendingImport = store.imports.getPending();
    if (pendingImport) {
      // Match the complete uploaded file before recovering a receipt for its replacement.
      if (digest === pendingImport.targetDigest) {
        accept(data, digest, { importRequestId: pendingImport.requestId });
        return;
      }
      store.imports.discard(pendingImport.requestId);
    }
    const pending = store.mutations.getPending();
    if (pending) {
      // A restart may find the replacement plus later edits to unrelated rows.
      const target = data.records.find(({ incident }) => incident.id === pending.id);
      if (target?.fingerprint === pending.targetFingerprint) {
        accept(data, digest, { mutation: pending });
        return;
      }
      store.mutations.discard(pending.requestId);
    }
    if (digest !== acceptedDigest || snapshot.source.status !== "ok") accept(data, digest);
  }

  async function poll(): Promise<void> {
    try {
      const bytes = await readFile(livePath);
      const digest = sha256(bytes);
      if (digest === failedResetDigest) return;
      failedResetDigest = undefined;
      if (snapshot.source.status === "ok" && digest === acceptedDigest) {
        pendingDigest = undefined;
        return;
      }
      if (digest !== pendingDigest) {
        pendingDigest = digest;
        return;
      }
      acceptCurrent(normalizeIncidents(bytes, options.itsmTemplate), digest);
      pendingDigest = undefined;
    } catch {
      pendingDigest = undefined;
      markSourceFailed();
    }
  }

  function completedMutation(requestId: string, commandFingerprint: string): MutationResult | undefined {
    if (store.imports.getCompleted(requestId)) throw requestIdConflict();
    const prior = store.mutations.getCompleted(requestId);
    if (!prior) return undefined;
    if (prior.fingerprint !== commandFingerprint) throw requestIdConflict();
    return prior.result;
  }

  function completedImport(requestId: string, commandFingerprint: string): ImportApplyResult | undefined {
    if (store.mutations.getCompleted(requestId)) throw requestIdConflict();
    const prior = store.imports.getCompleted(requestId);
    if (!prior) return undefined;
    if (prior.fingerprint !== commandFingerprint) throw requestIdConflict();
    return prior.result;
  }

  async function readForMutation() {
    try {
      const bytes = await readFile(livePath);
      const digest = sha256(bytes);
      if (digest !== failedResetDigest) return { bytes, digest, data: normalizeIncidents(bytes, options.itsmTemplate) };
    } catch {
      // The last accepted snapshot stays available while the live file is invalid or missing.
    }
    markSourceFailed();
    throw new MutationError(409, "SOURCE_UNAVAILABLE", "Рабочий файл отсутствует, повреждён или недоступен.");
  }

  function readOptionalLiveFile(): Promise<Buffer | null> {
    return readFile(livePath).catch((error: unknown) => {
      if (isMissingFile(error)) return null;
      throw error;
    });
  }

  async function requireSourceDigest(expected: string | null): Promise<void> {
    try {
      const bytes = await readOptionalLiveFile();
      if ((bytes === null ? null : sha256(bytes)) === expected) return;
    } catch {
      // A file that cannot be read cannot be safely replaced either.
    }
    throw new MutationError(409, "SOURCE_CHANGED", "Рабочий файл изменился. Перечитайте данные и повторите действие.");
  }

  async function replaceLiveFile(
    bytes: Buffer,
    data: NormalizedIncidents,
    digest: string,
    previous: LiveFile,
    operation: { mutation: PendingMutation } | { importRequestId: string },
  ) {
    const discard = "mutation" in operation
      ? () => store.mutations.discard(operation.mutation.requestId)
      : () => store.imports.discard(operation.importRequestId);
    try {
      await atomicWrite(livePath, bytes, () => requireSourceDigest(previous.digest));
    } catch (error) {
      discard();
      throw error;
    }

    try {
      const saved = accept(data, digest, operation);
      failedResetDigest = undefined;
      return saved;
    } catch (error) {
      try {
        if (previous.bytes === null) {
          await requireSourceDigest(digest);
          await rm(livePath);
        } else {
          await atomicWrite(livePath, previous.bytes, () => requireSourceDigest(digest));
        }
        discard();
      } catch {
        // The next valid read can settle the pending operation if rollback was interrupted.
        markSourceFailed();
      }
      throw error;
    }
  }

  async function applyMutation(command: ItsmCommand): Promise<MutationResult> {
    const { requestId: suppliedId, ...intent } = command;
    const requestId = suppliedId.toLowerCase();
    const commandFingerprint = fingerprint(intent);
    const prior = completedMutation(requestId, commandFingerprint);
    if (prior) return prior;

    const current = await readForMutation();
    acceptCurrent(current.data, current.digest);
    pendingDigest = undefined;
    const recovered = completedMutation(requestId, commandFingerprint);
    if (recovered) return recovered;

    const { id, rows } = planMutation(command, current.data.records, store.getTicketVersion, now());
    const updated = Buffer.from(`${JSON.stringify(rows, null, 2)}\n`);
    const data = normalizeIncidents(updated, options.itsmTemplate);
    const target = data.records.find(({ incident }) => incident.id === id);
    if (!target) throw new Error("Изменённая заявка отсутствует в рабочем файле.");
    const digest = sha256(updated);
    const pending = { requestId, fingerprint: commandFingerprint, id, targetFingerprint: target.fingerprint };
    store.mutations.begin(pending);
    const result = (await replaceLiveFile(updated, data, digest, current, { mutation: pending }))?.mutation;
    if (!result) throw new Error("Результат операции отсутствует.");
    return result;
  }

  async function refreshImportBase(): Promise<LiveFile> {
    let bytes: Buffer | null;
    try {
      bytes = await readOptionalLiveFile();
    } catch {
      markSourceFailed();
      throw new MutationError(409, "SOURCE_UNAVAILABLE", "Рабочий файл недоступен.");
    }
    const file: LiveFile = bytes === null ? { bytes: null, digest: null } : { bytes, digest: sha256(bytes) };
    pendingDigest = undefined;
    if (file.bytes !== null && file.digest !== failedResetDigest) {
      let data: NormalizedIncidents | undefined;
      try {
        data = normalizeIncidents(file.bytes, options.itsmTemplate);
      } catch (error) {
        if (!(error instanceof InvalidIncidentFile || error instanceof RangeError)) throw error;
      }
      if (data) {
        acceptCurrent(data, file.digest);
        return file;
      }
    }
    // A valid import can restore a missing or malformed live file from the last accepted revision.
    markSourceFailed();
    return file;
  }

  async function applyImport(command: ImportApplyRequest): Promise<ImportApplyResult> {
    const { requestId: suppliedId, ...intent } = command;
    const requestId = suppliedId.toLowerCase();
    const commandFingerprint = fingerprint(intent);
    const prior = completedImport(requestId, commandFingerprint);
    if (prior) return prior;

    const previous = await refreshImportBase();
    const recovered = completedImport(requestId, commandFingerprint);
    if (recovered) return recovered;

    if (command.expectedRevision !== snapshot.revision) throw revisionConflict();
    const preview = importPreviews.get(command.previewId);
    if (!preview) throw new MutationError(409, "PREVIEW_UNAVAILABLE", "Предпросмотр недоступен. Выполните его заново.");
    if (command.expectedRevision !== preview.revision) throw revisionConflict();

    const { bytes } = preview;
    const data = normalizeIncidents(bytes, options.itsmTemplate);
    const digest = sha256(bytes);
    // Any pending replacement left after a malformed or missing source cannot be verified.
    const pendingImport = store.imports.getPending();
    if (pendingImport) store.imports.discard(pendingImport.requestId);
    const pendingMutation = store.mutations.getPending();
    if (pendingMutation) store.mutations.discard(pendingMutation.requestId);

    store.imports.begin({ requestId, fingerprint: commandFingerprint, targetDigest: digest });
    const saved = await replaceLiveFile(bytes, data, digest, previous, { importRequestId: requestId });
    if (!saved) throw new Error("Результат импорта отсутствует.");
    importPreviews.delete(command.previewId);
    return { revision: saved.revision };
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => {}, () => {});
    return result;
  }

  function schedule(): void {
    if (closed) return;
    timer = setTimeout(() => {
      void enqueue(poll).then(schedule);
    }, options.pollMs);
    timer.unref();
  }

  // Confirm a present file twice before the first API response.
  await poll();
  if (pendingDigest !== undefined) {
    await delay(options.pollMs);
    await poll();
  }
  schedule();

  return {
    getSnapshot,
    getDescription: (id) => descriptions.get(id) ?? null,
    listCoordinators: () => coordinators,
    listTickets: store.listTickets,
    getTicket: store.getTicket,
    async mutate(command) {
      if (closed) throw new Error("Источник уже остановлен.");
      return enqueue(() => applyMutation(command));
    },
    previewImport({ jsonText }) {
      if (closed) throw new Error("Источник уже остановлен.");
      return importPreviews.create(jsonText, snapshot.revision, store.getPresentFingerprints);
    },
    async applyImport(command) {
      if (closed) throw new Error("Источник уже остановлен.");
      return enqueue(() => applyImport(command));
    },
    subscribe(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async resetTo(bytes) {
      if (closed) throw new Error("Источник уже остановлен.");
      const input = Uint8Array.from(bytes);
      return enqueue(async () => {
        const data = normalizeIncidents(input, options.itsmTemplate);
        const digest = sha256(input);
        const previous = await readOptionalLiveFile();

        if (previous && (store.mutations.getPending() || store.imports.getPending())) {
          const previousDigest = sha256(previous);
          if (previousDigest !== failedResetDigest) {
            try {
              acceptCurrent(normalizeIncidents(previous, options.itsmTemplate), previousDigest);
            } catch (error) {
              if (!(error instanceof InvalidIncidentFile)) throw error;
            }
          }
        }

        await atomicWrite(livePath, input);
        pendingDigest = undefined;
        try {
          accept(data, digest, { reset: true });
          failedResetDigest = undefined;
          return getSnapshot();
        } catch (error) {
          // SQLite rolled back. Restore the file unless an external edit has replaced it.
          try {
            if (sha256(await readFile(livePath)) === digest) {
              if (previous === null) await rm(livePath);
              else await atomicWrite(livePath, previous);
            }
          } catch {
            failedResetDigest = digest;
            markSourceFailed();
          }
          throw error;
        }
      });
    },
    close() {
      if (closing) return closing;
      closed = true;
      clearTimeout(timer);
      listeners.clear();
      closing = tail.then(() => store.close());
      return closing;
    },
  };
}
