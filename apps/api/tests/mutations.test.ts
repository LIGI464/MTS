import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { API_PREFIX, COORDINATOR_TEAM, SnapshotSchema, type MutationResult, type TicketDetail } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as files from "../src/source/file.js";
import { BASELINE_FILENAME, LIVE_FILENAME, fingerprint } from "../src/source/input.js";
import { createApp } from "../src/start.js";
import { openDashboardStore } from "../src/store/index.js";

const incidents = `${API_PREFIX}/itsm/incidents`;
const scenarios = `${API_PREFIX}/dev/scenarios`;
const token = "synthetic-d21-operator";
const now = "2032-06-03T12:00:00.000Z";
const due = "2032-06-03T12:01:30.000Z";
const requestId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const primary = {
  id: "SYN-D21/01",
  sysId: "0009007199254740993123456789",
  submitDate: "2032-06-03 11:30:00",
  deadline: "",
  stateEnum: "WorkInProgress",
  priorityId: 2,
  assignedGroupName: "Другая команда",
  assignedEmployee: "Синтетический исполнитель",
  lastAssignmentToTeamDateTime: "2032-06-03 11:35:00",
  solution: "Первоначальное решение",
  extension: { flags: ["  raw  ", null, 0], notes: { seen: false } },
};
const secondary = { id: "SYN-D21/02", submitDate: primary.submitDate, stateEnum: "Assigned", priorityId: 3 };
const finished = { id: "SYN-D21/03", submitDate: primary.submitDate, stateEnum: "Closed", priorityId: 3 };
const baselineRows = [secondary, primary, finished];
const encode = (rows: unknown) => Buffer.from(JSON.stringify(rows));

describe("D21 mutations (SYN-D21)", () => {
  let root: string;
  let live: string;
  let baseline: string;
  let dbPath: string;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mts-d21-"));
    live = join(root, LIVE_FILENAME);
    baseline = join(root, BASELINE_FILENAME);
    dbPath = join(root, "dashboard.sqlite");
    await files.atomicWrite(live, encode(baselineRows));
    await files.atomicWrite(baseline, encode(baselineRows));
    vi.setSystemTime(new Date(now));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await app?.close();
    app = undefined;
    await rm(root, { recursive: true, force: true });
  });

  async function start(operator = true) {
    await app?.close();
    app = await createApp({ MTS_DATA_DIR: root, MTS_DATA_POLL_MS: "20", MTS_OPERATOR_TOKEN: operator ? token : undefined });
  }

  function post(url: string, payload: object, authorization: string | null = `Bearer ${token}`) {
    return app!.inject({ method: "POST", url, payload, headers: authorization ? { authorization } : {} });
  }

  async function ticket(id = primary.id) {
    const response = await app!.inject(`${incidents}/${encodeURIComponent(id)}`);
    expect(response.statusCode).toBe(200);
    return response.json<TicketDetail>();
  }

  async function snapshot() {
    return SnapshotSchema.parse((await app!.inject(`${API_PREFIX}/dashboard`)).json());
  }

  async function rawRows() {
    return JSON.parse(await readFile(live, "utf8")) as Record<string, unknown>[];
  }

  function resolve(id: string, version: string, solution: string, index: number) {
    return post(`${incidents}/${encodeURIComponent(id)}/resolve`, {
      expectedVersion: version, solution, requestId: requestId(index),
    });
  }

  it("requires the operator on both routes before parsing the request", async () => {
    for (const [operator, expected] of [[false, 404], [true, 403]] as const) {
      await start(operator);
      for (const url of [scenarios, `${incidents}/SYN-D21%2F01/resolve`]) {
        const malformed = await app!.inject({
          method: "POST", url, payload: "{", headers: { "content-type": "application/json" },
        });
        expect(malformed.statusCode).toBe(expected);
        expect((await post(url, {}, "Bearer wrong")).statusCode).toBe(expected);
      }
      expect((await snapshot()).revision).toBe(1);
      expect(await readFile(live)).toEqual(encode(baselineRows));
    }
  });

  it("validates strict bodies and rejects unknown, archived, and inactive targets", async () => {
    await start();
    const { version } = (await ticket()).ticket;
    const invalidScenarios = [
      { action: "create-critical", requestId: "not-a-uuid" },
      { action: "create-critical", requestId: requestId(1), id: primary.id },
      { action: "critical", requestId: requestId(1) },
      { action: "assign", id: primary.id, requestId: requestId(1) },
      { action: "deadline", id: primary.id, expectedVersion: version, requestId: requestId(1), deadline: "2032-02-30T12:00:00Z" },
      { action: "deadline", id: primary.id, expectedVersion: version, requestId: requestId(1), deadline: "2032-06-03T12:00:00" },
    ];
    for (const invalid of invalidScenarios) expect((await post(scenarios, invalid)).statusCode).toBe(400);
    for (const invalid of [" \n ", "🧪".repeat(1001)]) {
      expect((await resolve(primary.id, version, invalid, 1)).statusCode).toBe(400);
    }
    expect((await post(`${incidents}/SYN-D21%2F01/resolve`, {
      solution: "Строка", expectedVersion: version, requestId: requestId(1), stateId: 7,
    })).statusCode).toBe(400);
    expect((await resolve("SYN-D21/unknown", version, "Решение", 1)).statusCode).toBe(404);
    const invalidTransition = await resolve(finished.id, (await ticket(finished.id)).ticket.version, "Решение", 1);
    expect(invalidTransition.statusCode).toBe(409);
    expect(invalidTransition.json()).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await readFile(live)).toEqual(encode(baselineRows));

    await files.atomicWrite(live, encode([secondary, finished]));
    const archived = await resolve(primary.id, version, "Решение", 1);
    expect(archived.statusCode).toBe(409);
    expect(archived.json()).toMatchObject({ code: "TICKET_ARCHIVED" });
    expect((await ticket()).ticket.present).toBe(false);
  });

  it("creates one critical incident and keeps the original receipt after restart and reset", async () => {
    await start();
    const create = { action: "create-critical", requestId: requestId(1) };
    const responses = await Promise.all([post(scenarios, create), post(scenarios, create)]);
    for (const response of responses) expect(response.statusCode).toBe(200);
    const result = responses[0].json<MutationResult>();
    expect(responses[1].json()).toEqual(result);
    expect(result.id).toMatch(/^INC-SYN-/);
    expect(result.revision).toBe(2);
    expect(await rawRows()).toEqual([...baselineRows, expect.objectContaining({
      id: result.id, sysId: expect.any(String), stateEnum: "Assigned", state: "Назначен",
      priorityId: 4, priority: "Наивысший", submitDate: now, lastAssignmentToTeamDateTime: now, deadline: due,
    })]);
    const detail = await ticket(result.id);
    expect(detail.ticket).toMatchObject({ version: result.version, present: true, priority: 4, state: "Assigned" });
    expect(detail.ticket.team).not.toBe(COORDINATOR_TEAM);
    expect(detail.history).toHaveLength(1);
    expect((await snapshot()).groups.critical).toEqual([result.id]);

    const collision = await resolve(result.id, result.version, "Другое действие", 1);
    expect(collision.statusCode).toBe(409);
    expect(collision.json()).toMatchObject({ code: "REQUEST_ID_CONFLICT" });
    await start();
    expect((await post(scenarios, { requestId: create.requestId, action: create.action })).json()).toEqual(result);
    const reset = await post(`${API_PREFIX}/demo/reset`, {});
    expect(reset.statusCode).toBe(200);
    await start();
    expect((await post(scenarios, create)).json()).toEqual(result);
    expect(await rawRows()).toEqual(baselineRows);
    expect(await readFile(baseline)).toEqual(encode(baselineRows));
    expect((await ticket(result.id)).history.map(({ present }) => present)).toEqual([false, true]);
  });

  it("applies all targeted actions, preserving the raw export and original solution history", async () => {
    await start();
    let version = (await ticket()).ticket.version;
    const steps = [
      { action: "escalate", changes: { priorityId: 4, priority: "Наивысший" } },
      { action: "assign", changes: {
        assignedGroupName: COORDINATOR_TEAM, assignedEmployee: null, lastAssignmentToTeamDateTime: now,
      } },
      { action: "deadline", deadline: due, changes: { deadline: due } },
    ];
    let expected = { ...primary };
    for (const [index, { changes, ...action }] of steps.entries()) {
      const response = await post(scenarios, { ...action, id: primary.id, expectedVersion: version, requestId: requestId(index + 1) });
      expect(response.statusCode).toBe(200);
      const result = response.json<MutationResult>();
      expect(result).toEqual({ id: primary.id, version: expect.any(String), revision: index + 2 });
      expect(result.version).not.toBe(version);
      version = result.version;
      expect((await ticket()).ticket.version).toBe(version);
      expected = { ...expected, ...changes } as typeof primary;
      expect(await rawRows()).toEqual([secondary, expected, finished]);
    }
    expect((await snapshot()).groups).toMatchObject({ critical: [primary.id], coordinator: [primary.id], high: [secondary.id] });

    const complete = await resolve(primary.id, version, "  Очередь восстановлена. 🧪  ", 4);
    expect(complete.statusCode).toBe(200);
    const result = complete.json<MutationResult>();
    expect(result).toEqual({ id: primary.id, version: expect.any(String), revision: 5 });
    expect((await resolve(primary.id, version, "  Очередь восстановлена. 🧪  ", 4)).json()).toEqual(result);
    const changedBody = await resolve(primary.id, version, "Очередь восстановлена. 🧪", 4);
    expect(changedBody.json()).toMatchObject({ code: "REQUEST_ID_CONFLICT" });
    expect(changedBody.statusCode).toBe(409);
    expect(await rawRows()).toEqual([secondary, {
      ...expected, solution: "Очередь восстановлена. 🧪", stateEnum: "Resolved",
      state: "Завершен", stateId: 7, completionDate: now,
    }, finished]);
    expect(await readFile(baseline)).toEqual(encode(baselineRows));

    await start();
    const current = await snapshot();
    expect(current.revision).toBe(result.revision);
    expect(current.groups).toMatchObject({ critical: [], coordinator: [], high: [secondary.id] });
    expect(current.notices.at(-1)).toMatchObject({ kind: "critical.resolved", incidentId: primary.id });
    const detail = await ticket();
    expect(detail).toMatchObject({
      ticket: { version: result.version, state: "Resolved", resolvedAt: now, hasSolution: true }, solution: "Очередь восстановлена. 🧪",
    });
    expect(detail.history.map(({ solution }) => solution)).toEqual([
      "Очередь восстановлена. 🧪", ...Array.from({ length: 4 }, () => primary.solution),
    ]);
  });

  it("serializes competing versions, while updates for separate IDs both succeed", async () => {
    await start();
    const first = (await ticket()).ticket;
    const second = (await ticket(secondary.id)).ticket;
    const commands = [
      { action: "escalate", id: first.id, expectedVersion: first.version, requestId: requestId(1) },
      { action: "assign", id: first.id, expectedVersion: first.version, requestId: requestId(2) },
      { action: "deadline", id: second.id, expectedVersion: second.version, deadline: due, requestId: requestId(3) },
    ];
    const [left, right, independent] = await Promise.all(commands.map((command) => post(scenarios, command)));
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    expect([left, right].find(({ statusCode }) => statusCode === 409)?.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    expect(independent.statusCode).toBe(200);
    expect((await ticket()).history).toHaveLength(2);
    expect((await ticket(secondary.id)).ticket).toMatchObject({ dueAt: due, version: independent.json().version });
    expect((await snapshot()).revision).toBe(3);
  });

  it("rechecks external edits before a mutation, preserves them, and keeps watching after it", async () => {
    await start();
    const version = (await ticket()).ticket.version;
    const external = { ...primary, extension: { ...primary.extension, notes: { seen: true } } };
    await files.atomicWrite(live, encode([secondary, external, finished]));
    const stale = await resolve(primary.id, version, "Старый ввод", 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await rawRows())[1]).toEqual(external);

    const updated = await resolve(primary.id, (await ticket()).ticket.version, "Решение через API", 2);
    expect(updated.statusCode).toBe(200);
    const after = await rawRows();
    await files.atomicWrite(live, encode([after[0], { ...after[1], solution: "Решение извне" }, after[2]]));
    await expect.poll(async () => (await ticket()).solution).toBe("Решение извне");
    expect((await ticket()).history.map(({ solution }) => solution)).toEqual([
      "Решение извне", "Решение через API", primary.solution, primary.solution,
    ]);

    await files.atomicWrite(live, Buffer.from("{"));
    const unavailable = await post(scenarios, { action: "create-critical", requestId: requestId(3) });
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json()).toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    expect((await snapshot()).source.status).toBe("stale");
    expect(await readFile(live, "utf8")).toBe("{");
    expect((await ticket()).solution).toBe("Решение извне");
  });

  it("clears a failed file write and detects a late external edit before replacement", async () => {
    await start();
    const create = { action: "create-critical", requestId: requestId(1) };
    const realWrite = files.atomicWrite;
    const writer = vi.spyOn(files, "atomicWrite");
    writer.mockRejectedValueOnce(new Error("simulated write failure"));
    expect((await post(scenarios, create)).statusCode).toBe(500);
    expect(await readFile(live)).toEqual(encode(baselineRows));
    expect((await snapshot()).revision).toBe(1);

    const external = [{ ...secondary, custom: { externallyEdited: true } }, primary, finished];
    writer.mockImplementationOnce(async (path, bytes, beforeReplace) => {
      await realWrite(path, encode(external));
      await realWrite(path, bytes, beforeReplace);
    });
    const conflict = await post(scenarios, create);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "SOURCE_CHANGED" });
    expect(await rawRows()).toEqual(external);
    expect((await post(scenarios, create)).statusCode).toBe(200);
    expect((await rawRows()).slice(0, -1)).toEqual(external);
  });

  it("rolls back the file, archive, snapshot and receipt when SQLite rejects the commit", async () => {
    await start();
    const original = await ticket();
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TRIGGER reject_receipt BEFORE UPDATE ON itsm_mutations
        BEGIN SELECT RAISE(ABORT, 'simulated receipt failure'); END;
      `);
      const failed = await resolve(primary.id, original.ticket.version, "Решение", 1);
      expect(failed.statusCode).toBe(500);
      expect(await readFile(live)).toEqual(encode(baselineRows));
      expect(await ticket()).toEqual(original);
      expect((await snapshot()).revision).toBe(1);
      expect(db.prepare("SELECT count(*) AS total FROM itsm_mutations").get()?.total).toBe(0);
      db.exec("DROP TRIGGER reject_receipt");
    } finally {
      db.close();
    }
    await start();
    expect((await resolve(primary.id, original.ticket.version, "Решение", 1)).statusCode).toBe(200);
    expect((await ticket()).history).toHaveLength(2);
  });

  it.each([false, true])("recovers an interrupted command across restart (file replaced = %s)", async (replaced) => {
    await start();
    const { version } = (await ticket()).ticket;
    const intent = { action: "escalate", id: primary.id, expectedVersion: version };
    const id = requestId(1);
    const expected = { ...primary, priorityId: 4, priority: "Наивысший" };
    await app!.close();
    app = undefined;
    const store = openDashboardStore(dbPath);
    try {
      store.mutations.begin({ requestId: id, id: primary.id, fingerprint: fingerprint(intent), targetFingerprint: fingerprint(expected) });
    } finally {
      store.close();
    }
    if (replaced) await files.atomicWrite(live, encode([{ ...secondary, external: true }, expected, finished]));

    await start();
    expect((await ticket()).history).toHaveLength(replaced ? 2 : 1);
    const retry = await post(scenarios, { ...intent, requestId: id });
    expect(retry.statusCode).toBe(200);
    const result = retry.json<MutationResult>();
    expect(result).toEqual({ id: primary.id, version: (await ticket()).ticket.version, revision: 2 });
    expect((await ticket()).history).toHaveLength(2);
    expect(await rawRows()).toEqual([replaced ? { ...secondary, external: true } : secondary, expected, finished]);
  });
});
