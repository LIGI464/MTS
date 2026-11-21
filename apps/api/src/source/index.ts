import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CoordinatorList, MutationResult, Notice, Snapshot } from "@mts/contracts";
import { buildGroups, diffNotices } from "../domain/index.js";
import { MutationError, planMutation, requireTicketVersion, type ItsmCommand } from "../itsm/mutation.js";
import type { DashboardRuntime, DashboardRuntimeOptions } from "../runtime-contract.js";
import { openDashboardStore, type DashboardMutation } from "../store/index.js";
import { inferCoordinatorDirectory, projectCoordinators, readCoordinatorDirectory } from "./coordinators.js";
import { atomicWrite, isMissingFile } from "./file.js";
import { InvalidIncidentFile, LIVE_FILENAME, fingerprint, normalizeIncidents, sha256, type NormalizedIncidents } from "./input.js";

export async function createDashboardRuntime(options: DashboardRuntimeOptions): Promise<DashboardRuntime> {
  await mkdir(options.dataDir, { recursive: true });
  const configuredDirectory = await readCoordinatorDirectory(options.dataDir);
  const livePath = join(options.dataDir, LIVE_FILENAME);
  const store = openDashboardStore(join(options.dataDir, "dashboard.sqlite"));
  const listeners = new Set<(snapshot: Snapshot) => void>();

  let persisted: ReturnType<typeof store.load>;
  let coordinators: CoordinatorList;
  try {
    persisted = store.load();
    coordinators = configuredDirectory ?? inferCoordinatorDirectory(store.listPresentRaw());
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
    { reset = false, mutation }: { reset?: boolean; mutation?: DashboardMutation } = {},
  ): MutationResult | undefined {
    const directory = configuredDirectory ?? inferCoordinatorDirectory(source.records.map(({ raw }) => raw));
    const assignments = store.getCoordinatorAssignments();
    if (mutation?.coordinator) assignments.set(mutation.id, mutation.coordinator);
    const data = projectCoordinators(source, directory, assignments);
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
    });
    acceptedDigest = digest;
    coordinators = directory;
    if (!saved) return;

    const { revision, notices } = saved;
    descriptions = new Map(data.descriptions);
    snapshot = { ...snapshot, revision, notices, incidents: data.incidents, groups, source: { status: "ok", lastGoodAt: at } };
    publish();
    return saved.mutation;
  }

  function acceptCurrent(data: NormalizedIncidents, digest: string): void {
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
    const prior = store.mutations.getCompleted(requestId);
    if (!prior) return undefined;
    if (prior.fingerprint !== commandFingerprint) {
      throw new MutationError(409, "REQUEST_ID_CONFLICT", "Этот requestId уже использован для другого действия.");
    }
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

  async function requireSourceDigest(expected: string): Promise<void> {
    const bytes = await readFile(livePath).catch(() => null);
    if (bytes === null || sha256(bytes) !== expected) {
      throw new MutationError(409, "SOURCE_CHANGED", "Рабочий файл изменился. Перечитайте карточку и повторите действие.");
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

    if (command.action === "set-coordinator") {
      requireTicketVersion(command, store.getTicketVersion);
      const coordinator = coordinators.find(({ id }) => id === command.coordinatorId);
      if (!coordinator) throw new MutationError(404, "COORDINATOR_NOT_FOUND", "Координатор недоступен в справочнике.");
      const target = current.data.records.find(({ incident }) => incident.id === command.id);
      if (!target) throw new Error("Заявка отсутствует в принятом снимке.");
      await requireSourceDigest(current.digest);
      const result = accept(current.data, current.digest, { mutation: {
        requestId, fingerprint: commandFingerprint, id: command.id, targetFingerprint: target.fingerprint, coordinator,
      } });
      if (!result) throw new Error("Результат операции отсутствует.");
      return result;
    }

    const { id, rows } = planMutation(command, current.data.records, store.getTicketVersion, now());
    const updated = Buffer.from(`${JSON.stringify(rows, null, 2)}\n`);
    const data = normalizeIncidents(updated, options.itsmTemplate);
    const target = data.records.find(({ incident }) => incident.id === id);
    if (!target) throw new Error("Изменённая заявка отсутствует в рабочем файле.");
    const digest = sha256(updated);
    const pending = { requestId, fingerprint: commandFingerprint, id, targetFingerprint: target.fingerprint };
    store.mutations.begin(pending);
    try {
      await atomicWrite(livePath, updated, () => requireSourceDigest(current.digest));
    } catch (error) {
      store.mutations.discard(requestId);
      throw error;
    }

    let result: MutationResult | undefined;
    try {
      result = accept(data, digest, { mutation: pending });
    } catch (error) {
      try {
        await atomicWrite(livePath, current.bytes, () => requireSourceDigest(digest));
        store.mutations.discard(requestId);
      } catch {
        // If rollback is interrupted, a valid file will settle the pending operation on the next read.
        markSourceFailed();
      }
      throw error;
    }
    if (!result) throw new Error("Результат операции отсутствует.");
    return result;
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
        const previous = await readFile(livePath).catch((error: unknown) => {
          if (isMissingFile(error)) return null;
          throw error;
        });

        if (previous && store.mutations.getPending()) {
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
