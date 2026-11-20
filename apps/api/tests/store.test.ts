import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeMockTimeline, type Notice } from "@mts/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDashboardStore, type DashboardStore, type StoredDashboard } from "../src/store/index.js";

const at = "2025-01-01T00:00:00.000Z";
const fixture = makeMockTimeline(Date.parse(at)).frames.critical;
const state: Omit<StoredDashboard, "notices"> = {
  revision: fixture.revision,
  lastGoodAt: at,
  incidents: fixture.incidents,
  descriptions: [[fixture.incidents[0].id, "Описание для анализа"]],
};
const event: Omit<Notice, "seq"> = {
  kind: "critical.new",
  incidentId: fixture.incidents[0].id,
  title: fixture.incidents[0].title,
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
    const notices = store.save(state, Array.from({ length: 510 }, () => event));
    expect(notices.map(({ seq }) => seq)).toEqual(Array.from({ length: 50 }, (_, index) => 461 + index));
    expect(database.prepare("SELECT COUNT(*) AS count FROM notices").get()?.count).toBe(500);

    store.close();
    store = openDashboardStore(path);
    expect(store.load()).toEqual({ ...state, notices });
    const next = { ...state, revision: state.revision + 1 };
    expect(store.save(next, [reset], true)).toEqual([{ ...reset, seq: 511 }]);
    expect(database.prepare("SELECT COUNT(*) AS count FROM notices").get()?.count).toBe(1);
  });

  it("rolls back the snapshot and cleared journal when the reset notice cannot be stored", () => {
    const notices = store.save(state, [event]);
    database.exec(`
      CREATE TRIGGER reject_reset BEFORE INSERT ON notices WHEN NEW.kind = 'demo.reset'
      BEGIN SELECT RAISE(ABORT, 'blocked reset'); END;
    `);
    const next = { ...state, revision: state.revision + 1, incidents: [], descriptions: [] };
    expect(() => store.save(next, [reset], true)).toThrow("blocked reset");
    expect(store.load()).toEqual({ ...state, notices });

    database.exec("DROP TRIGGER reject_reset");
    expect(store.save(next, [reset], true)).toEqual([{ ...reset, seq: 2 }]);
  });
});
