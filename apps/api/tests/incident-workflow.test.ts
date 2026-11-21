import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  API_PREFIX, COORDINATOR_TEAM, AssignCoordinatorResultSchema, CoordinatorListSchema, FullTicketDetailSchema, SnapshotSchema,
  type AssignCoordinator, type AssignCoordinatorResult, type TicketList,
} from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/start.js";
import { BASELINE_FILENAME, LIVE_FILENAME } from "../src/source/input.js";

const registry = `${API_PREFIX}/itsm/incidents`;
const coordinatorPath = `${API_PREFIX}/coordinators`;
const token = "synthetic-d23-operator";
const first = { id: "0001", name: "Синтетический координатор А" };
const second = { id: "90071992547409939999", name: "Синтетический координатор Б" };
const directory = [first, second];
const requestId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const ticketUrl = (id: string) => `${registry}/${encodeURIComponent(id)}`;
const assignmentUrl = (id: string) => `${ticketUrl(id)}/coordinator`;

const states = [
  ...Array.from({ length: 14 }, () => "Assigned"),
  ...Array.from({ length: 10 }, () => "WorkInProgress"),
  ...Array.from({ length: 10 }, () => "Resolved"),
  ...Array.from({ length: 5 }, () => "Closed"),
  ...Array.from({ length: 5 }, () => "Research"),
];
const assignedEmployees = [first.name, second.name, null, "  "];
const rows = states.map((stateEnum, index) => {
  const row = {
    id: `SYN-D23/${String(index).padStart(2, "0")}`,
    sysId: `00090071992547409939${index}`,
    stateEnum,
    state: "Назначен",
    stateId: stateEnum === "Resolved" ? 7 : stateEnum === "Closed" ? 10 : null,
    priorityId: index < 16 ? 1 : index < 39 ? 2 : 3,
    urgencyId: 0,
    impactId: null,
    submitDate: "2032-06-03 11:30:00",
    deadline: index >= 41 ? "" : "2032-06-03 12:00:00",
    completionDate: index >= 24 ? "2032-06-03 11:55:00" : null,
    waitingExitDate: "0001-01-01T00:00:00",
    assignedGroupName: [COORDINATOR_TEAM, ` ${COORDINATOR_TEAM}`, COORDINATOR_TEAM, COORDINATOR_TEAM][index]
      ?? "Синтетическая другая группа",
    assignedEmployee: index < assignedEmployees.length ? assignedEmployees[index] : "Синтетический исполнитель",
    description: "  Исходное описание\n",
    solution: "Синтетическое решение",
    extension: { flags: [null, false, 0, "0"], ["__proto__"]: false },
  };
  const extraFields = Array.from({ length: 46 - Object.keys(row).length }, (_, key) => [`syntheticField${key}`, key]);
  return { ...row, ...Object.fromEntries(extraFields) };
});

describe("D23 incident workflow", () => {
  let dataDir: string;
  let live: string;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mts-d23-"));
    live = join(dataDir, LIVE_FILENAME);
    await writeFile(live, JSON.stringify(rows));
    await writeFile(join(dataDir, BASELINE_FILENAME), JSON.stringify(rows));
  });

  afterEach(async () => {
    try {
      await app?.close();
    } finally {
      app = undefined;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  async function start({ configured = true, operator = true } = {}) {
    await app?.close();
    app = undefined;
    if (configured) await writeFile(join(dataDir, "coordinators.json"), JSON.stringify(directory));
    app = await createApp({ MTS_DATA_DIR: dataDir, MTS_DATA_POLL_MS: "20", MTS_OPERATOR_TOKEN: operator ? token : undefined });
    return app;
  }

  async function detail(id: string) {
    const response = await app!.inject(ticketUrl(id));
    expect(response.statusCode).toBe(200);
    return FullTicketDetailSchema.parse(response.json());
  }

  async function snapshot() {
    return SnapshotSchema.parse((await app!.inject(`${API_PREFIX}/dashboard`)).json());
  }

  function post(url: string, payload: object, authorization = `Bearer ${token}`) {
    return app!.inject({ method: "POST", url, payload, headers: { authorization } });
  }

  it("accepts all 44 synthetic records and returns all 46 original fields per record", async () => {
    await start();
    const list = (await app!.inject(registry)).json<TicketList>();
    expect(list.items).toHaveLength(44);
    const board = await snapshot();
    expect(board.incidents.filter(({ state }) => state === "Assigned" || state === "WorkInProgress")).toHaveLength(24);
    expect([1, 2, 3, 4].map((priority) => board.incidents.filter((item) => item.priority === priority).length))
      .toEqual([16, 23, 5, 0]);
    expect(board.incidents.filter(({ dueAt }) => dueAt === null)).toHaveLength(3);
    expect(board.incidents.every((item) => !Object.hasOwn(item, "rawFields"))).toBe(true);

    const details = await Promise.all(rows.map(({ id }) => detail(id)));
    for (const [index, { ticket, rawFields }] of details.entries()) {
      expect(Object.keys(rawFields)).toHaveLength(46);
      expect(rawFields).toEqual(rows[index]);
      expect(Object.hasOwn(rawFields.extension as object, "__proto__")).toBe(true);
      expect(ticket.state).toBe(rows[index].stateEnum);
      expect(ticket).toEqual(list.items[index]);
    }
    expect(details[24].rawFields.stateId).toBe(7);
    expect(details[34].rawFields.stateId).toBe(10);
    expect(details[0].ticket.coordinator).toEqual(first);
    for (const index of [1, 2, 3, 4]) expect(details[index].ticket.coordinator).toBeUndefined();
    expect(board.incidents[0].coordinator).toEqual(first);

    const lookup = await app!.inject(coordinatorPath);
    expect(lookup.statusCode).toBe(200);
    expect(lookup.headers["cache-control"]).toBe("no-store");
    expect(CoordinatorListSchema.parse(lookup.json())).toEqual(directory);
  });

  it("assigns and replaces independently of the source, publishes SSE, and replays receipts across restart", async () => {
    const { id } = rows[4];
    const server = await start();
    const original = await detail(id);
    const originalBytes = await readFile(live);
    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    const response = await fetch(`${address}${API_PREFIX}/events`, { signal: AbortSignal.timeout(3000) });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    async function nextSnapshot() {
      while (!buffer.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE ended before the next dashboard event");
        buffer += chunk.value;
      }
      const end = buffer.indexOf("\n\n");
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      expect(frame).toMatch(/^event: dashboard\ndata: /);
      return SnapshotSchema.parse(JSON.parse(frame.slice("event: dashboard\ndata: ".length)));
    }

    const assignment: AssignCoordinator = { coordinatorId: first.id, expectedVersion: original.ticket.version, requestId: requestId(1) };
    let accepted: AssignCoordinatorResult;
    let replaced: AssignCoordinatorResult;
    try {
      const initial = await nextSnapshot();
      const [result, replay] = await Promise.all([post(assignmentUrl(id), assignment), post(assignmentUrl(id), assignment)]);
      expect([result.statusCode, replay.statusCode]).toEqual([200, 200]);
      accepted = AssignCoordinatorResultSchema.parse(result.json());
      expect(replay.json()).toEqual(accepted);
      expect(accepted).toEqual({ id, version: expect.any(String), revision: initial.revision + 1 });
      expect(accepted.version).not.toBe(original.ticket.version);

      const firstFrame = await nextSnapshot();
      expect(firstFrame.revision).toBe(accepted.revision);
      const card = firstFrame.incidents.find((item) => item.id === id);
      expect(card?.coordinator).toEqual(first);
      expect(card?.version).not.toBe(initial.incidents.find((item) => item.id === id)?.version);
      expect(firstFrame.notices).toMatchObject([{ kind: "coordinator.changed", incidentId: id }]);
      expect(firstFrame.groups).toEqual(initial.groups);

      const conflict = await post(assignmentUrl(id), { ...assignment, coordinatorId: second.id, requestId: requestId(2) });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe("VERSION_CONFLICT");
      const reused = await post(assignmentUrl(id), { ...assignment, coordinatorId: second.id });
      expect(reused.statusCode).toBe(409);
      expect(reused.json().code).toBe("REQUEST_ID_CONFLICT");

      const replace = await post(assignmentUrl(id), { coordinatorId: second.id, expectedVersion: accepted.version, requestId: requestId(2) });
      expect(replace.statusCode).toBe(200);
      replaced = AssignCoordinatorResultSchema.parse(replace.json());
      const secondFrame = await nextSnapshot();
      expect(secondFrame.revision).toBe(accepted.revision + 1);
      expect(secondFrame.revision).toBe(replaced.revision);
      expect(secondFrame.incidents.find((item) => item.id === id)?.coordinator).toEqual(second);
      expect(secondFrame.notices.map(({ kind }) => kind)).toEqual(["coordinator.changed", "coordinator.changed"]);
    } finally {
      await reader.cancel();
    }

    const current = await detail(id);
    expect(current).toMatchObject({ ticket: { version: replaced.version, coordinator: second, team: original.ticket.team, assignee: original.ticket.assignee } });
    expect(current.rawFields).toEqual(original.rawFields);
    expect(current.history.map(({ coordinator }) => coordinator)).toEqual([second, first, undefined]);
    expect(await readFile(live)).toEqual(originalBytes);

    await start();
    expect((await snapshot()).revision).toBe(replaced.revision);
    expect(await detail(id)).toEqual(current);
    expect((await post(assignmentUrl(id), assignment)).json()).toEqual(accepted);
    const assignGroup = await post(`${API_PREFIX}/dev/scenarios`, {
      action: "assign", id, expectedVersion: current.ticket.version, requestId: requestId(3),
    });
    expect(assignGroup.statusCode).toBe(200);
    const afterGroupChange = await detail(id);
    expect(afterGroupChange.ticket).toMatchObject({ team: COORDINATOR_TEAM, assignee: null, coordinator: second });
    expect(afterGroupChange.rawFields).toMatchObject({ assignedGroupName: COORDINATOR_TEAM, assignedEmployee: null });
    expect((await snapshot()).notices.at(-1)).toMatchObject({ kind: "coordinator.assigned", incidentId: id });
  });

  it("uses the current accepted export as a fallback directory and validates operator and targets", async () => {
    const { id } = rows[4];
    await start({ configured: false, operator: false });
    const inferred = CoordinatorListSchema.parse((await app!.inject(coordinatorPath)).json());
    expect(inferred).toEqual([{ id: expect.any(String), name: first.name }]);
    expect((await detail(rows[0].id)).ticket.coordinator).toEqual(inferred[0]);
    expect((await post(assignmentUrl(id), {})).statusCode).toBe(404);

    await start({ configured: false });
    expect((await app!.inject(coordinatorPath)).json()).toEqual(inferred);
    expect((await post(assignmentUrl(id), {}, "Bearer wrong")).statusCode).toBe(403);
    expect((await post(assignmentUrl(id), {})).statusCode).toBe(400);
    const intent = { coordinatorId: inferred[0].id, expectedVersion: (await detail(id)).ticket.version, requestId: requestId(1) };
    const missing = await post(assignmentUrl("SYN-D23/missing"), intent);
    const unavailable = await post(assignmentUrl(id), { ...intent, coordinatorId: second.id });
    expect([missing.statusCode, unavailable.statusCode]).toEqual([404, 404]);
    expect([missing.json().code, unavailable.json().code]).toEqual(["NOT_FOUND", "COORDINATOR_NOT_FOUND"]);

    const rawEdited = rows.map((row) => row.id === id ? { ...row, extension: { edited: false } } : row);
    await writeFile(live, JSON.stringify(rawEdited));
    expect((await post(assignmentUrl(id), intent)).json().code).toBe("VERSION_CONFLICT");
    const changed = await detail(id);
    expect(changed.rawFields.extension).toEqual({ edited: false });
    const assignment = { ...intent, expectedVersion: changed.ticket.version };
    expect((await post(assignmentUrl(id), assignment)).statusCode).toBe(200);

    await writeFile(live, JSON.stringify(rawEdited.filter((row) => row.id !== id)));
    const archived = await post(assignmentUrl(id), { ...assignment, requestId: requestId(2) });
    expect(archived.statusCode).toBe(409);
    expect(archived.json().code).toBe("TICKET_ARCHIVED");
    expect(await detail(id)).toMatchObject({ ticket: { present: false, coordinator: inferred[0] }, rawFields: changed.rawFields });
  });

  it("rolls back the assignment, archive, snapshot and receipt together on a SQLite failure", async () => {
    const { id } = rows[4];
    await start();
    const before = await detail(id);
    const revision = (await snapshot()).revision;
    const intent = { coordinatorId: first.id, expectedVersion: before.ticket.version, requestId: requestId(1) };
    const database = new DatabaseSync(join(dataDir, "dashboard.sqlite"));
    try {
      database.exec(`
        CREATE TRIGGER reject_receipt BEFORE UPDATE ON itsm_mutations
        BEGIN SELECT RAISE(ABORT, 'synthetic D23 receipt failure'); END;
      `);
      expect((await post(assignmentUrl(id), intent)).statusCode).toBe(500);
      expect(await detail(id)).toEqual(before);
      expect((await snapshot()).revision).toBe(revision);
      expect(database.prepare("SELECT count(*) AS total FROM itsm_coordinator_assignments").get()?.total).toBe(0);
      expect(database.prepare("SELECT count(*) AS total FROM itsm_mutations").get()?.total).toBe(0);
      database.exec("DROP TRIGGER reject_receipt");
      expect((await post(assignmentUrl(id), intent)).statusCode).toBe(200);
      expect((await detail(id)).history).toHaveLength(2);
    } finally {
      database.close();
    }
  });
});
