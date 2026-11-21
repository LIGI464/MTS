import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { COORDINATOR_TEAM, type Snapshot } from "@mts/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardRuntime } from "../src/runtime-contract.js";
import { atomicWrite } from "../src/source/file.js";
import { createDashboardRuntime } from "../src/source/index.js";
import { InvalidIncidentFile, LIVE_FILENAME, normalizeIncidents } from "../src/source/input.js";

const now = "2026-11-20T12:00:00.000Z";
const pollMs = 10;

function raw(id: string, fields: Record<string, unknown> = {}) {
  return { id, priorityId: 3, stateEnum: "Assigned", submitDate: "2026-11-20 12:00:00", ...fields };
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value));
}

describe("incident file normalization", () => {
  it("accepts BOM and UTC formats, follows the enum, and keeps the full description private", () => {
    const description = "🚦".repeat(281);
    const encoded = Buffer.from("\uFEFF" + JSON.stringify([
      raw("b", { stateEnum: null, state: " Завершён " }),
      raw("a /", {
        sysId: "0007?+",
        header: " ",
        shortDescription: "",
        description,
        stateEnum: "Research",
        state: "Закрыт",
        stateId: 7,
        deadline: "",
        completionDate: "2026-11-20T15:00:00+03:00",
        assignedGroupName: ` ${COORDINATOR_TEAM} `,
        assignedEmployee: " ",
        urgencyId: 9,
        impactId: 2,
      }),
    ]));
    const result = normalizeIncidents(encoded, "https://itsm.example/incidents/{id}?sys={sysId}");
    expect(result.incidents).toMatchObject([
      {
        id: "a /",
        title: "a /",
        state: "Research",
        stateLabel: "Исследование ситуации",
        createdAt: now,
        dueAt: null,
        resolvedAt: now,
        team: COORDINATOR_TEAM,
        assignee: null,
        urgency: null,
        impact: 2,
        summary: "🚦".repeat(280),
        itsmUrl: "https://itsm.example/incidents/a%20%2F?sys=0007%3F%2B",
      },
      { id: "b", state: "Resolved", stateLabel: "Завершен", createdAt: now },
    ]);
    expect(result.incidents[0]).not.toHaveProperty("description");
    expect(result.descriptions).toEqual([["a /", description], ["b", null]]);
  });

  it("keeps a stable version for equivalent values and includes private analysis input in the hash", () => {
    const initial = raw("card", { shortDescription: "Тема", description: "Подробности" });
    const baseline = normalizeIncidents(encode([initial])).incidents[0];
    const equivalent = {
      description: " Подробности ",
      shortDescription: "Тема",
      unrelated: { key: "value" },
      submitDate: now,
      stateEnum: "Assigned",
      priorityId: 3,
      id: "card",
    };
    expect(normalizeIncidents(encode([equivalent])).incidents[0]).toEqual(baseline);
    const updated = normalizeIncidents(encode([{ ...initial, description: "Изменение" }])).incidents[0];
    expect(updated.summary).toBe(baseline.summary);
    expect(updated.version).not.toBe(baseline.version);
  });

  it("retains an unknown enum's original label and excludes unusable ITSM links", () => {
    const bytes = encode([raw("card", { stateEnum: "Pending", state: "Назначен", productUrl: "https://product.example" })]);
    for (const template of [undefined, "http://itsm.example/{id}", "https://itsm.example/{sysId}", "https://itsm.example/"]) {
      expect(normalizeIncidents(bytes, template).incidents[0]).toMatchObject({
        state: "Other", stateLabel: "Назначен", itsmUrl: null,
      });
    }
  });

  it("rejects malformed UTF-8, duplicate IDs and invalid rows", () => {
    const invalidFiles = [
      Buffer.from([0xff]),
      encode([raw("a"), raw(" a ")]),
      encode([raw("a"), raw("b", { submitDate: "2026-02-30 12:00:00" })]),
    ];
    for (const bytes of invalidFiles) {
      expect(() => normalizeIncidents(bytes)).toThrow(InvalidIncidentFile);
    }
  });
});

describe("dashboard source runtime", () => {
  let dataDir: string;
  let livePath: string;
  let runtime: DashboardRuntime | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mts-source-"));
    livePath = join(dataDir, LIVE_FILENAME);
    vi.setSystemTime(new Date(now));
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await runtime?.close();
    } finally {
      runtime = undefined;
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  async function start() {
    runtime = await createDashboardRuntime({
      dataDir,
      pollMs,
      capabilities: { demoReset: true, liveAnalysis: false },
    });
    return runtime;
  }

  function waitFor(check: () => void) {
    return vi.waitFor(check, { timeout: 1500, interval: pollMs });
  }

  it("starts unavailable and suppresses notices on the first valid file", async () => {
    const source = await start();
    expect(source.getSnapshot()).toMatchObject({
      revision: 0, incidents: [], source: { status: "unavailable", lastGoodAt: null },
    });
    await atomicWrite(livePath, encode([
      raw("critical", { priorityId: undefined, "Категория": "Наивысший", assignedGroupName: COORDINATOR_TEAM }),
    ]));
    await waitFor(() => expect(source.getSnapshot()).toMatchObject({
      revision: 1,
      source: { status: "ok", lastGoodAt: now },
      groups: { critical: ["critical"], coordinator: ["critical"] },
      notices: [],
    }));
  });

  it("clears an unconfirmed cached coordinator when no accepted raw record exists", async () => {
    const rows = [
      raw("card", { assignedGroupName: COORDINATOR_TEAM, assignedEmployee: "   " }),
      raw("research", { assignedGroupName: COORDINATOR_TEAM, stateEnum: "Research" }),
    ];
    await atomicWrite(livePath, encode(rows));
    const source = await start();
    const original = source.getSnapshot();
    expect(original.groups.coordinator).toEqual(["card", "research"]);
    expect(original.incidents.map(({ coordinator }) => coordinator)).toEqual([null, null]);
    await source.close();

    const database = new DatabaseSync(join(dataDir, "dashboard.sqlite"));
    try {
      database.exec("DELETE FROM itsm_incidents; DELETE FROM itsm_history;");
      const cached = original.incidents.map((incident) => ({
        ...incident, coordinator: { id: "previous", name: "Старое ручное назначение" },
      }));
      database.prepare("UPDATE dashboard SET incidents = ?").run(JSON.stringify(cached));
    } finally {
      database.close();
    }
    await rm(livePath);

    const restarted = await start();
    expect(restarted.getSnapshot()).toEqual({ ...original, source: { ...original.source, status: "stale" } });
    expect(restarted.listTickets().items).toEqual([]);
  });

  it("ignores ordering and formatting changes and restores the same revision after invalid input", async () => {
    const records = [raw("a"), raw("b", { description: "Серверное описание" })];
    await atomicWrite(livePath, encode(records));
    const source = await start();
    const snapshots: Snapshot[] = [];
    const unsubscribe = source.subscribe((snapshot) => snapshots.push(snapshot));
    const formatted = Buffer.from(JSON.stringify(records.toReversed(), null, 2));
    await atomicWrite(livePath, formatted);

    await delay(pollMs * 6);
    expect(snapshots).toEqual([]);
    expect(source.getSnapshot().revision).toBe(1);

    const later = "2026-11-20T12:01:00.000Z";
    vi.setSystemTime(new Date(later));
    await atomicWrite(livePath, encode([raw("a"), raw("a")]));
    await waitFor(() => expect(source.getSnapshot().source.status).toBe("stale"));
    expect(source.getSnapshot()).toMatchObject({
      revision: 1,
      serverNow: later,
      source: { status: "stale", lastGoodAt: now },
    });
    expect(source.getDescription("b")).toBe("Серверное описание");

    await atomicWrite(livePath, formatted);
    await waitFor(() => expect(source.getSnapshot().source.status).toBe("ok"));
    expect(snapshots.map(({ revision, source }) => [revision, source.status])).toEqual([[1, "stale"], [1, "ok"]]);
    unsubscribe();
    await rm(livePath);
    await waitFor(() => expect(source.getSnapshot().source.status).toBe("stale"));
    expect(snapshots).toHaveLength(2);
  });

  it("loads the last snapshot and journal on restart with broken input and keeps reset sequences increasing", async () => {
    const initial = encode([raw("a")]);
    const changed = encode([raw("a", { "Категория": "Наивысший", description: "Сохранённое описание" })]);
    await atomicWrite(livePath, initial);
    const first = await start();
    await atomicWrite(livePath, changed);
    await waitFor(() => expect(first.getSnapshot().revision).toBe(2));
    const previous = first.getSnapshot();
    expect(previous.groups.critical).toEqual(["a"]);
    expect(previous.notices).toMatchObject([{ kind: "critical.new", incidentId: "a" }]);
    await first.close();

    await atomicWrite(livePath, Buffer.from("["));
    const second = await start();
    expect(second.getSnapshot()).toEqual({
      ...previous,
      source: { ...previous.source, status: "stale" },
    });
    expect(second.getDescription("a")).toBe("Сохранённое описание");

    const reset = await second.resetTo(initial);
    expect(reset.revision).toBe(3);
    expect(reset.source.status).toBe("ok");
    expect(reset.notices).toEqual([{ seq: previous.notices[0].seq + 1, kind: "demo.reset", at: now, incidentId: null, title: null }]);
    expect(await readFile(livePath)).toEqual(initial);
    expect(second.getDescription("a")).toBeNull();

    await second.close();
    const third = await start();
    expect(third.getSnapshot().notices).toEqual(reset.notices);
    expect((await third.resetTo(initial)).notices[0].seq).toBe(reset.notices[0].seq + 1);
  });

  it("rolls back a failed reset after the SQLite snapshot write and restores the live file", async () => {
    const initial = encode([raw("a")]);
    const changed = encode([raw("a", { priorityId: 4 })]);
    await atomicWrite(livePath, initial);
    const source = await start();
    await atomicWrite(livePath, changed);
    await waitFor(() => expect(source.getSnapshot().revision).toBe(2));
    const previous = source.getSnapshot();

    const db = new DatabaseSync(join(dataDir, "dashboard.sqlite"));
    try {
      db.exec(`
        CREATE TRIGGER fail_reset BEFORE INSERT ON notices WHEN NEW.kind = 'demo.reset'
        BEGIN
          SELECT RAISE(ABORT, 'simulated reset failure');
        END;
      `);
      await expect(source.resetTo(initial)).rejects.toThrow("simulated reset failure");
      expect(source.getSnapshot()).toEqual(previous);
      expect(await readFile(livePath)).toEqual(changed);
      db.exec("DROP TRIGGER fail_reset");
    } finally {
      db.close();
    }

    await source.close();
    const restarted = await start();
    expect(restarted.getSnapshot()).toEqual(previous);
    expect((await restarted.resetTo(initial)).notices[0].seq).toBe(previous.notices[0].seq + 1);
  });
});
