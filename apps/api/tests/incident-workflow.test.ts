import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import {
  API_PREFIX, COORDINATOR_TEAM, CoordinatorListSchema, FullTicketDetailSchema, SnapshotSchema, type TicketList,
} from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWrite } from "../src/source/file.js";
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
const assignedEmployees = [`  ${first.name}  `, second.name, null, "  "];
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
    for (const index of [1, 2, 3, 4]) expect(details[index].ticket.coordinator).toBeNull();
    expect(board.groups.coordinator).toEqual(expect.arrayContaining([rows[2].id, rows[3].id]));
    expect(board.incidents[0].coordinator).toEqual(first);

    const lookup = await app!.inject(coordinatorPath);
    expect(lookup.statusCode).toBe(200);
    expect(lookup.headers["cache-control"]).toBe("no-store");
    expect(CoordinatorListSchema.parse(lookup.json())).toEqual(directory);
  });

  it("publishes a real name change and team entry over SSE and ignores the same export", async () => {
    const { id } = rows[0];
    const entering = rows[4].id;
    const server = await start();
    const original = await detail(id);
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

    try {
      const initial = await nextSnapshot();
      const changed = rows.map((row) => row.id === id ? { ...row, assignedEmployee: second.name } : row);
      await atomicWrite(live, Buffer.from(JSON.stringify(changed)));
      const update = await nextSnapshot();
      expect(update.revision).toBe(initial.revision + 1);
      expect(update.incidents.find((card) => card.id === id)?.coordinator).toEqual(second);
      expect(update.notices).toMatchObject([{ kind: "coordinator.changed", incidentId: id }]);
      expect(update.notices).toHaveLength(1);
      const current = await detail(id);
      expect(current.ticket).toMatchObject({ coordinator: second, assignee: second.name });
      expect(current.ticket.version).not.toBe(original.ticket.version);
      expect(current.history.map(({ coordinator }) => coordinator)).toEqual([second, first]);
      expect((await app!.inject(registry)).json<TicketList>().items.find((item) => item.id === id)).toEqual(current.ticket);

      await atomicWrite(live, Buffer.from(JSON.stringify(changed, null, 2)));
      await delay(120);
      expect(await snapshot()).toMatchObject({ revision: update.revision, notices: update.notices });
      expect(await detail(id)).toEqual(current);

      const changedTeam = changed.map((row) => row.id === entering
        ? { ...row, assignedGroupName: COORDINATOR_TEAM, assignedEmployee: null }
        : row);
      await atomicWrite(live, Buffer.from(JSON.stringify(changedTeam)));
      const entry = await nextSnapshot();
      expect(entry.revision).toBe(update.revision + 1);
      expect(entry.groups.coordinator).toContain(entering);
      expect(entry.notices).toHaveLength(2);
      expect(entry.notices.at(-1)).toMatchObject({ kind: "coordinator.assigned", incidentId: entering });
      expect((await detail(entering)).ticket.coordinator).toBeNull();
    } finally {
      await reader.cancel();
    }
  });

  it.each(["available", "missing", "invalid"] as const)(
    "projects current reads from legacy SQLite when the export is %s and preserves the old versions",
    async (source) => {
      const { id } = rows[0];
      await start();
      const original = await detail(id);
      const originalSnapshot = await snapshot();
      await app!.close();
      app = undefined;

      const legacyVersion = requestId(99);
      const legacy = { id: "legacy", name: "Синтетическое ручное назначение" };
      const database = new DatabaseSync(join(dataDir, "dashboard.sqlite"));
      try {
        database.exec(`
          CREATE TABLE itsm_coordinator_assignments (
            incident_id TEXT PRIMARY KEY REFERENCES itsm_incidents (id),
            coordinator_id TEXT NOT NULL,
            name TEXT NOT NULL
          ) STRICT;
        `);
        database.prepare("INSERT INTO itsm_coordinator_assignments VALUES (?, ?, ?)").run(id, legacy.id, legacy.name);
        const current = database.prepare(`
          INSERT INTO itsm_history (incident_id, version, at, present, fingerprint, raw, ticket)
          SELECT incident_id, ?, at, present, fingerprint, raw, json_set(ticket, '$.coordinator', json(?))
          FROM itsm_history WHERE version = ?
        `).run(legacyVersion, JSON.stringify(legacy), original.ticket.version);
        database.prepare("UPDATE itsm_incidents SET latest_seq = ? WHERE id = ?").run(current.lastInsertRowid, id);
        const cached = originalSnapshot.incidents.map((card) => card.id === id
          ? { ...card, coordinator: legacy, version: "legacy-cached-card" }
          : card);
        database.prepare("UPDATE dashboard SET incidents = ?").run(JSON.stringify(cached));
        if (source === "missing") await rm(live);
        if (source === "invalid") await writeFile(live, "[");

        await start();
        const board = await snapshot();
        expect(board.source.status).toBe(source === "available" ? "ok" : "stale");
        expect(board.incidents.find((card) => card.id === id)?.coordinator).toEqual(first);
        expect(board.notices).toEqual(originalSnapshot.notices);
        const currentDetail = await detail(id);
        expect(currentDetail.ticket).toEqual({ ...original.ticket, version: legacyVersion });
        expect(currentDetail.history.map(({ version, coordinator }) => ({ version, coordinator }))).toEqual([
          { version: legacyVersion, coordinator: legacy },
          { version: original.ticket.version, coordinator: first },
        ]);
        expect((await app!.inject(registry)).json<TicketList>().items.find((item) => item.id === id)).toEqual(currentDetail.ticket);
        expect(database.prepare("SELECT name FROM itsm_coordinator_assignments WHERE incident_id = ?").get(id)?.name).toBe(legacy.name);
      } finally {
        database.close();
      }
    },
  );

  it("infers stable IDs when the directory is absent and uses the same fallback for an unknown name", async () => {
    const id = rows[0].id;
    await start({ configured: false });
    const inferred = CoordinatorListSchema.parse((await app!.inject(coordinatorPath)).json());
    expect(inferred).toEqual([{ id: expect.stringMatching(/^exported:/), name: first.name }]);
    expect((await detail(id)).ticket.coordinator).toEqual(inferred[0]);
    await start({ configured: false });
    expect((await app!.inject(coordinatorPath)).json()).toEqual(inferred);

    await writeFile(join(dataDir, "coordinators.json"), JSON.stringify([second]));
    await start({ configured: false });
    expect((await app!.inject(coordinatorPath)).json()).toEqual([second]);
    expect((await detail(id)).ticket.coordinator).toEqual(inferred[0]);
    expect((await snapshot()).incidents.find((card) => card.id === id)?.coordinator).toEqual(inferred[0]);
  });

  it("rejects the old assignment route and group scenario with a valid operator token without writes", async () => {
    const { id } = rows[0];
    await start();
    const old = await detail(id);
    const initial = await snapshot();
    const bytes = await readFile(live);
    const request = { expectedVersion: old.ticket.version, requestId: requestId(1) };
    expect((await post(assignmentUrl(id), { ...request, coordinatorId: second.id })).statusCode).toBe(404);
    expect((await post(`${API_PREFIX}/dev/scenarios`, { ...request, action: "assign", id })).statusCode).toBe(400);
    expect(await detail(id)).toEqual(old);
    expect(await snapshot()).toMatchObject({ revision: initial.revision, notices: initial.notices });
    expect(await readFile(live)).toEqual(bytes);
    const database = new DatabaseSync(join(dataDir, "dashboard.sqlite"));
    try {
      expect(database.prepare("SELECT count(*) AS total FROM itsm_mutations").get()?.total).toBe(0);
    } finally {
      database.close();
    }
  });
});
