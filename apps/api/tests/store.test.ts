import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Notice } from "@mts/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeIncidents } from "../src/source/input.js";
import { openDashboardStore, type DashboardStore } from "../src/store/index.js";

const at = "2025-01-01T00:00:00.000Z";
const { records, descriptions } = normalizeIncidents(Buffer.from(JSON.stringify([{
  id: "SYN-STORE-01", submitDate: at, priorityId: 4, description: "Описание для анализа",
}])));
const state = {
  incidents: records.map(({ incident }) => ({ ...incident, coordinator: null })),
  descriptions, revision: 0, lastGoodAt: at,
};
const event: Omit<Notice, "seq"> = {
  kind: "critical.new",
  incidentId: state.incidents[0].id,
  title: state.incidents[0].title,
  at,
};
const reset: Omit<Notice, "seq"> = { kind: "demo.reset", incidentId: null, title: null, at };

describe("SQLite dashboard store", () => {
  let directory: string;
  let path: string;
  let store: DashboardStore;
  let database: DatabaseSync;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mts-dashboard-store-"));
    path = join(directory, "dashboard.sqlite");
    store = openDashboardStore(path);
    database = new DatabaseSync(path);
  });

  afterEach(() => {
    database.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps the newest 500 notices and a monotonic sequence after restart and reset", () => {
    expect(store.load()).toBeNull();
    const { revision, notices } = store.save(
      { ...state, records }, Array.from({ length: 510 }, () => event), { dashboardChanged: true },
    )!;
    expect(notices.map(({ seq }) => seq)).toEqual(Array.from({ length: 50 }, (_, index) => 461 + index));
    expect(database.prepare("SELECT COUNT(*) AS count FROM notices").get()?.count).toBe(500);

    store.close();
    store = openDashboardStore(path);
    expect(store.load()).toEqual({ ...state, revision, notices });
    expect(store.save({ ...state, records, revision }, [reset], { reset: true })).toEqual({
      revision: revision + 1, notices: [{ ...reset, seq: 511, revision: revision + 1 }],
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM notices").get()?.count).toBe(1);
  });

  it("keeps legacy notice IDs and records the revision for new events", () => {
    const accepted = store.save({ ...state, records }, [event], { dashboardChanged: true })!;
    store.close();
    database.exec("ALTER TABLE notices DROP COLUMN revision");
    store = openDashboardStore(path);
    expect(store.load()?.notices).toEqual([{ ...event, seq: 1 }]);
    const next = store.save({ ...state, records, revision: accepted.revision }, [event], { dashboardChanged: true });
    expect(next?.notices).toEqual([{ ...event, seq: 1 }, { ...event, seq: 2, revision: accepted.revision + 1 }]);
  });

  it("rolls back the snapshot and cleared journal when the reset notice cannot be stored", () => {
    const accepted = store.save({ ...state, records }, [event], { dashboardChanged: true })!;
    const ticket = store.getTicket(event.incidentId!);
    database.exec(`
      CREATE TRIGGER reject_reset BEFORE INSERT ON notices WHEN NEW.kind = 'demo.reset'
      BEGIN SELECT RAISE(ABORT, 'blocked reset'); END;
    `);
    const next = { ...state, revision: accepted.revision, incidents: [], descriptions: [], records: [] };
    expect(() => store.save(next, [reset], { reset: true })).toThrow("blocked reset");
    expect(store.load()).toEqual({ ...state, ...accepted });
    expect(store.getTicket(event.incidentId!)).toEqual(ticket);

    database.exec("DROP TRIGGER reject_reset");
    expect(store.save(next, [reset], { reset: true })).toEqual({
      revision: accepted.revision + 1, notices: [{ ...reset, seq: 2, revision: accepted.revision + 1 }],
    });
    expect(store.getTicket(event.incidentId!)?.history.map(({ present }) => present)).toEqual([false, true]);
  });
});
