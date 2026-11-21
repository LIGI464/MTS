import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { API_PREFIX, SnapshotSchema, type Snapshot, type TicketDetail, type TicketList } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/index.js";
import { atomicWrite } from "../src/source/file.js";
import { createDashboardRuntime } from "../src/source/index.js";
import { BASELINE_FILENAME, LIVE_FILENAME, normalizeIncidents } from "../src/source/input.js";

const registry = `${API_PREFIX}/itsm/incidents`;
const itsmTemplate = "https://itsm.example/{id}?sysId={sysId}";
const operatorToken = "synthetic-d20-operator";
const pollMs = 10;
const observedAt = (minute: number) => new Date(Date.UTC(2026, 10, 20, 12, minute)).toISOString();

const primary = {
  id: "SYN-D20/01",
  sysId: "0009007199254740993123456789",
  header: "Синтетическая заявка",
  stateEnum: "Assigned",
  submitDate: "2026-11-20 10:00:00",
  deadline: "",
  impactId: 0,
  priorityId: 3,
  description: "Исходное описание",
  solution: "  <b>Решение A</b>\n",
  custom: { flags: [false, 0, null], metadata: { note: "<tag>", value: 1 } },
};
const blank = { id: "SYN-D20/02", priorityId: 2, submitDate: primary.submitDate, solution: " \n " };
const temporary = { id: "SYN-D20/03", priorityId: 4, submitDate: primary.submitDate, solution: "Временное решение" };
const initial = [primary, blank];
const encode = (rows: unknown) => Buffer.from(JSON.stringify(rows));

describe("D20 synthetic archive (SYN-D20)", () => {
  let dataDir: string;
  let live: string;
  let databasePath: string;
  let server: FastifyInstance;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mts-itsm-"));
    live = join(dataDir, LIVE_FILENAME);
    databasePath = join(dataDir, "dashboard.sqlite");
    vi.setSystemTime(new Date(observedAt(0)));
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await server?.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  async function start() {
    const runtime = await createDashboardRuntime({
      dataDir, pollMs, itsmTemplate, capabilities: { demoReset: true, liveAnalysis: false },
    });
    server = buildApp({ runtime, dataDir, operatorToken, env: {} });
    return runtime;
  }

  async function list() {
    const response = await server.inject(registry);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    return response.json<TicketList>();
  }

  async function ticket(id = primary.id) {
    const response = await server.inject(`${registry}/${encodeURIComponent(id)}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    return response.json<TicketDetail>();
  }

  function waitFor(check: () => void) {
    return vi.waitFor(check, { interval: pollMs, timeout: 2000 });
  }

  it("imports original fields into a clean database and serves uncached, URL-encoded reads", async () => {
    const longId = `SYN-D20/${"x".repeat(110)}`;
    await atomicWrite(live, encode([...initial, { ...blank, id: longId, solution: null }]));
    const runtime = await start();
    const detail = await ticket();
    const empty = await ticket(blank.id);
    expect(await list()).toEqual({ items: [detail.ticket, empty.ticket, (await ticket(longId)).ticket] });
    expect(detail.ticket).toEqual({
      id: primary.id, version: expect.any(String), title: primary.header, product: null, service: null,
      team: null, assignee: null, coordinator: null, state: "Assigned", stateLabel: "Назначен", priority: 3,
      createdAt: "2026-11-20T10:00:00.000Z", dueAt: null, resolvedAt: null, present: true, hasSolution: true,
    });
    expect(detail).toMatchObject({ description: primary.description, solution: primary.solution });
    expect(detail.history).toEqual([{
      version: detail.ticket.version, at: observedAt(0), present: true, stateLabel: "Назначен",
      team: null, coordinator: null, dueAt: null, priority: 3, description: primary.description, solution: primary.solution,
    }]);
    expect(empty).toMatchObject({ ticket: { present: true, hasSolution: false }, description: null, solution: null });
    expect(await ticket()).toEqual(detail);

    const missing = await server.inject(`${registry}/SYN-D20%2Funknown`);
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
    expect(missing.json()).toEqual({ code: "NOT_FOUND", message: "Заявка не найдена." });

    const snapshot = SnapshotSchema.parse(runtime.getSnapshot());
    expect(snapshot.incidents[0].itsmUrl).toBe(`https://itsm.example/SYN-D20%2F01?sysId=${primary.sysId}`);
    expect(snapshot.notices).toEqual([]);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = db.prepare("SELECT raw FROM itsm_history WHERE incident_id = ?").get(primary.id);
      expect(JSON.parse(row?.raw as string)).toEqual(primary);
    } finally {
      db.close();
    }
  });

  it("backfills a pre-D20 dashboard even when its normalized snapshot already matches", async () => {
    const bytes = encode(initial);
    const { incidents, descriptions } = normalizeIncidents(bytes, itsmTemplate);
    const db = new DatabaseSync(databasePath);
    try {
      db.exec(`
        CREATE TABLE dashboard (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL CHECK (revision >= 0),
          last_good_at TEXT NOT NULL, incidents TEXT NOT NULL, descriptions TEXT NOT NULL
        ) STRICT;
        CREATE TABLE notices (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, incident_id TEXT, title TEXT, at TEXT NOT NULL
        ) STRICT;
      `);
      db.prepare("INSERT INTO dashboard VALUES (1, 12, ?, ?, ?)").run(
        observedAt(-1), JSON.stringify(incidents), JSON.stringify(descriptions),
      );
      db.prepare("INSERT INTO notices VALUES (41, 'demo.reset', NULL, NULL, ?)").run(observedAt(-1));
    } finally {
      db.close();
    }

    await atomicWrite(live, bytes);
    const runtime = await start();
    const imported = await ticket();
    expect(imported.history).toHaveLength(1);
    expect((await list()).items).toHaveLength(2);
    const snapshot = runtime.getSnapshot();
    expect(snapshot).toMatchObject({ incidents, notices: [{ seq: 41, kind: "demo.reset" }] });

    await server.close();
    const restarted = await start();
    expect(await ticket()).toEqual(imported);
    expect(restarted.getSnapshot().revision).toBe(snapshot.revision);
  });

  it("publishes accepted solution-only and nested changes including A → B → A", async () => {
    await atomicWrite(live, encode(initial));
    const runtime = await start();
    const baseline = runtime.getSnapshot();
    const first = await ticket();
    const otherTicket = await ticket(blank.id);
    const published: Snapshot[] = [];
    runtime.subscribe((snapshot) => published.push(snapshot));

    const solutionB = "Решение B";
    const changed = { ...primary, solution: solutionB };
    vi.setSystemTime(new Date(observedAt(1)));
    await atomicWrite(live, encode([changed, blank]));
    await waitFor(() => expect(published).toHaveLength(1));
    expect(published[0]).toMatchObject({ revision: baseline.revision + 1, incidents: baseline.incidents, notices: [] });
    const second = await ticket();
    expect(second).toMatchObject({ ticket: { hasSolution: true, state: "Assigned" }, solution: solutionB });
    expect(second.ticket.version).not.toBe(first.ticket.version);

    vi.setSystemTime(new Date(observedAt(2)));
    await atomicWrite(live, encode(initial));
    await waitFor(() => expect(published).toHaveLength(2));
    const returned = await ticket();
    expect(returned.ticket.version).not.toBe(first.ticket.version);
    expect(returned.history.map(({ at, solution }) => [at, solution])).toEqual([
      [observedAt(2), primary.solution], [observedAt(1), solutionB], [observedAt(0), primary.solution],
    ]);

    vi.setSystemTime(new Date(observedAt(3)));
    const nested = { ...primary, custom: { ...primary.custom, flags: [0, false, null] } };
    await atomicWrite(live, encode([nested, blank]));
    await waitFor(() => expect(published).toHaveLength(3));
    const afterNested = await ticket();
    expect(afterNested.history).toHaveLength(4);
    expect(afterNested.ticket.version).not.toBe(returned.ticket.version);
    expect(await ticket(blank.id)).toEqual(otherTicket);

    const reordered = Object.fromEntries(Object.entries({
      ...nested, custom: { metadata: { value: 1, note: "<tag>" }, flags: nested.custom.flags },
    }).reverse());
    await atomicWrite(live, Buffer.from(JSON.stringify([blank, reordered], null, 2)));
    await delay(pollMs * 6);
    expect(published).toHaveLength(3);
    expect(await ticket()).toEqual(afterNested);

    await server.close();
    const restarted = await start();
    expect(restarted.getSnapshot().revision).toBe(baseline.revision + 3);
    expect(await ticket()).toEqual(afterNested);
  });

  it("keeps old links for an empty source, a returning ID, and a demo reset", async () => {
    await atomicWrite(live, encode(initial));
    await atomicWrite(join(dataDir, BASELINE_FILENAME), encode(initial));
    const runtime = await start();
    const first = await ticket();

    vi.setSystemTime(new Date(observedAt(1)));
    await atomicWrite(live, encode([]));
    await waitFor(() => expect(runtime.getSnapshot().incidents).toEqual([]));
    const archived = await ticket();
    expect(archived).toMatchObject({ ticket: { present: false, hasSolution: true }, solution: primary.solution });
    expect(archived.history).toMatchObject([{ at: observedAt(1), present: false }, first.history[0]]);
    expect((await list()).items.map(({ present }) => present)).toEqual([false, false]);

    vi.setSystemTime(new Date(observedAt(2)));
    await atomicWrite(live, encode([primary, temporary]));
    await waitFor(() => expect(runtime.getSnapshot().incidents.map(({ id }) => id)).toEqual([primary.id, temporary.id]));
    const restored = await ticket();
    expect(restored.history.map(({ at, present }) => [at, present])).toEqual([
      [observedAt(2), true], [observedAt(1), false], [observedAt(0), true],
    ]);
    expect(new Set(restored.history.map(({ version }) => version)).size).toBe(3);

    vi.setSystemTime(new Date(observedAt(3)));
    const reset = await server.inject({
      method: "POST", url: `${API_PREFIX}/demo/reset`, headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(reset.statusCode).toBe(200);
    expect(SnapshotSchema.parse(reset.json())).toMatchObject({
      incidents: [{ id: primary.id }, { id: blank.id }], notices: [{ kind: "demo.reset" }],
    });
    expect(await ticket()).toEqual(restored);
    expect(await ticket(temporary.id)).toMatchObject({
      ticket: { present: false, hasSolution: true }, solution: temporary.solution,
      history: [{ at: observedAt(3), present: false }, { at: observedAt(2), present: true }],
    });
    expect((await list()).items.map(({ id, present }) => [id, present])).toEqual([
      [primary.id, true], [blank.id, true], [temporary.id, false],
    ]);
  });

  it("holds the last good snapshot and archive through malformed or missing input and restart", async () => {
    const unavailable = await start();
    expect(await list()).toEqual({ items: [] });
    expect(unavailable.getSnapshot().source.status).toBe("unavailable");
    await atomicWrite(live, encode(initial));
    await waitFor(() => expect(unavailable.getSnapshot().source.status).toBe("ok"));
    const first = await ticket();
    const snapshot = unavailable.getSnapshot();

    await atomicWrite(live, Buffer.from("[{"));
    await waitFor(() => expect(unavailable.getSnapshot().source.status).toBe("stale"));
    expect(await ticket()).toEqual(first);
    await server.close();

    const runtime = await start();
    expect(runtime.getSnapshot()).toMatchObject({ revision: snapshot.revision, source: { status: "stale" } });
    expect(await ticket()).toEqual(first);
    await rm(live);
    await delay(pollMs * 4);
    expect(await ticket()).toEqual(first);

    vi.setSystemTime(new Date(observedAt(1)));
    await atomicWrite(live, encode(initial));
    await waitFor(() => expect(runtime.getSnapshot().source.status).toBe("ok"));
    expect(runtime.getSnapshot().revision).toBe(snapshot.revision);
    expect(await ticket()).toEqual(first);
  });

  it("keeps more than 50 archive entries independently of demo resets and the public journal", async () => {
    await atomicWrite(live, encode([primary]));
    const runtime = await start();
    const first = await ticket();
    for (let version = 1; version <= 51; version++) {
      await runtime.resetTo(encode([{ ...primary, solution: `Решение ${version}` }]));
    }
    expect(runtime.getSnapshot().notices).toHaveLength(1);
    const { history, solution } = await ticket();
    expect(solution).toBe("Решение 51");
    expect(history).toHaveLength(52);
    expect(history.at(-1)).toEqual(first.history[0]);
  });
});
