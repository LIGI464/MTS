import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Notice, Snapshot } from "@mts/contracts";
import { buildGroups, diffNotices } from "../domain/index.js";
import type { DashboardRuntime, DashboardRuntimeOptions } from "../runtime-contract.js";
import { openDashboardStore } from "../store/index.js";
import { atomicWrite, isMissingFile } from "./file.js";
import { LIVE_FILENAME, normalizeIncidents, sha256, type NormalizedIncidents } from "./input.js";

export async function createDashboardRuntime(options: DashboardRuntimeOptions): Promise<DashboardRuntime> {
  await mkdir(options.dataDir, { recursive: true });
  const livePath = join(options.dataDir, LIVE_FILENAME);
  const store = openDashboardStore(join(options.dataDir, "dashboard.sqlite"));
  const listeners = new Set<(snapshot: Snapshot) => void>();

  let persisted: ReturnType<typeof store.load>;
  try {
    persisted = store.load();
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

  function accept(data: NormalizedIncidents, digest: string, reset = false): void {
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
    });
    acceptedDigest = digest;
    if (!saved) return;

    descriptions = new Map(data.descriptions);
    snapshot = { ...snapshot, ...saved, incidents: data.incidents, groups, source: { status: "ok", lastGoodAt: at } };
    publish();
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
      accept(normalizeIncidents(bytes, options.itsmTemplate), digest);
      pendingDigest = undefined;
    } catch {
      pendingDigest = undefined;
      markSourceFailed();
    }
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
    listTickets: store.listTickets,
    getTicket: store.getTicket,
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

        await atomicWrite(livePath, input);
        pendingDigest = undefined;
        try {
          accept(data, digest, true);
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
