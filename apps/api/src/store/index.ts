import { DatabaseSync } from "node:sqlite";
import { IncidentSchema, NoticeSchema, type Incident, type MutationResult, type Notice } from "@mts/contracts";
import { createCoordinatorProjection } from "../source/coordinators.js";
import type { SourceRecord } from "../source/input.js";
import { prepareImportJournal } from "./imports.js";
import { prepareItsmArchive } from "./itsm.js";
import { prepareMutationJournal, type PendingMutation } from "./mutations.js";

export type StoredDashboard = {
  revision: number;
  lastGoodAt: string;
  incidents: Incident[];
  descriptions: [string, string | null][];
  notices: Notice[];
};

type PendingNotice = Omit<Notice, "seq">;
type DashboardState = Omit<StoredDashboard, "notices"> & { records: readonly SourceRecord[] };
type SaveOptions = {
  dashboardChanged?: boolean;
  refreshSource?: boolean;
  reset?: boolean;
  mutation?: PendingMutation;
  importRequestId?: string;
};
type SaveResult = Pick<StoredDashboard, "revision" | "notices"> & { mutation?: MutationResult };

export type DashboardStore = {
  load(): StoredDashboard | null;
  save(state: DashboardState, events: readonly PendingNotice[], options: SaveOptions): SaveResult | null;
  listTickets: ReturnType<typeof prepareItsmArchive>["listTickets"];
  getTicket: ReturnType<typeof prepareItsmArchive>["getTicket"];
  getTicketVersion: ReturnType<typeof prepareItsmArchive>["getVersion"];
  getPresentFingerprints: ReturnType<typeof prepareItsmArchive>["getPresentFingerprints"];
  getPresentRaw: ReturnType<typeof prepareItsmArchive>["getPresentRaw"];
  mutations: Omit<ReturnType<typeof prepareMutationJournal>, "finish">;
  imports: Omit<ReturnType<typeof prepareImportJournal>, "finish">;
  close(): void;
};

function isDescriptionEntry(value: unknown): value is [string, string | null] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string"
    && (typeof value[1] === "string" || value[1] === null);
}

export function openDashboardStore(path: string, projectCoordinator = createCoordinatorProjection([])): DashboardStore {
  const database = new DatabaseSync(path);
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS dashboard (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        last_good_at TEXT NOT NULL,
        incidents TEXT NOT NULL,
        descriptions TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS notices (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        incident_id TEXT,
        title TEXT,
        at TEXT NOT NULL,
        revision INTEGER
      ) STRICT;
    `);
    transaction("BEGIN IMMEDIATE", () => {
      if (!database.prepare("PRAGMA table_info(notices)").all().some(({ name }) => name === "revision")) {
        database.exec("ALTER TABLE notices ADD COLUMN revision INTEGER");
      }
    });
    const archive = prepareItsmArchive(database, projectCoordinator);
    const mutations = prepareMutationJournal(database);
    const imports = prepareImportJournal(database);
    const dashboard = database.prepare(`
      SELECT revision, last_good_at AS lastGoodAt, incidents, descriptions
      FROM dashboard WHERE singleton = 1
    `);
    const writeDashboard = database.prepare(`
      INSERT INTO dashboard (singleton, revision, last_good_at, incidents, descriptions)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT (singleton) DO UPDATE SET
        revision = excluded.revision,
        last_good_at = excluded.last_good_at,
        incidents = excluded.incidents,
        descriptions = excluded.descriptions
    `);
    const appendNotice = database.prepare(`
      INSERT INTO notices (kind, incident_id, title, at, revision) VALUES (?, ?, ?, ?, ?)
    `);
    const readNotices = database.prepare(`
      SELECT seq, kind, incident_id AS incidentId, title, at, revision FROM (
        SELECT seq, kind, incident_id, title, at, revision FROM notices ORDER BY seq DESC LIMIT 50
      ) ORDER BY seq
    `);
    const trimNotices = database.prepare(`
      DELETE FROM notices WHERE seq <= (SELECT seq FROM notices ORDER BY seq DESC LIMIT 1 OFFSET 500)
    `);
    const noticeList = NoticeSchema.array();
    const incidentList = IncidentSchema.array();

    function recentNotices() {
      return noticeList.parse(readNotices.all().map(({ revision, ...notice }) =>
        revision === null ? notice : { ...notice, revision },
      ));
    }

    function transaction<T>(begin: "BEGIN" | "BEGIN IMMEDIATE", operation: () => T): T {
      database.exec(begin);
      try {
        const result = operation();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        if (database.isTransaction) database.exec("ROLLBACK");
        throw error;
      }
    }

    return {
      load() {
        return transaction("BEGIN", () => {
          const row = dashboard.get();
          if (!row) return null;
          const { revision, lastGoodAt, incidents, descriptions } = row;
          if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0
            || typeof lastGoodAt !== "string" || new Date(lastGoodAt).toJSON() !== lastGoodAt
            || typeof incidents !== "string" || typeof descriptions !== "string") {
            throw new Error("Некорректный снимок в SQLite");
          }
          const entries: unknown = JSON.parse(descriptions);
          if (!Array.isArray(entries) || !entries.every(isDescriptionEntry)) {
            throw new Error("Некорректные описания инцидентов в SQLite");
          }
          const raw = archive.getPresentRaw();
          return {
            revision,
            lastGoodAt,
            incidents: incidentList.parse(JSON.parse(incidents)).map((incident) => ({
              ...incident, coordinator: projectCoordinator(raw.get(incident.id)),
            })),
            descriptions: entries,
            notices: recentNotices(),
          };
        });
      },
      save(state, events, { dashboardChanged, refreshSource, reset, mutation, importRequestId }) {
        return transaction("BEGIN IMMEDIATE", () => {
          const { lastGoodAt, incidents, descriptions, records } = state;
          const archiveChanged = archive.sync(records, lastGoodAt);
          const changed = Boolean(dashboardChanged || archiveChanged || reset);
          if (!changed && !refreshSource && !mutation && !importRequestId) return null;

          const revision = state.revision + Number(changed);
          writeDashboard.run(revision, lastGoodAt, JSON.stringify(incidents), JSON.stringify(descriptions));
          if (reset) database.exec("DELETE FROM notices");
          for (const { kind, incidentId, title, at } of events) {
            appendNotice.run(kind, incidentId, title, at, revision);
          }
          trimNotices.run();
          const result: SaveResult = { revision, notices: recentNotices() };
          if (mutation) {
            const ticket = archive.getVersion(mutation.id);
            if (!ticket?.present) throw new Error("Заявка отсутствует в принятом снимке.");
            result.mutation = { id: mutation.id, version: ticket.version, revision };
            mutations.finish(mutation.requestId, result.mutation);
          }
          if (importRequestId) imports.finish(importRequestId, revision);
          if (reset) {
            const pending = mutations.getPending();
            if (pending) mutations.discard(pending.requestId);
            const pendingImport = imports.getPending();
            if (pendingImport) imports.discard(pendingImport.requestId);
          }
          return result;
        });
      },
      listTickets: archive.listTickets,
      getTicket: archive.getTicket,
      getTicketVersion: archive.getVersion,
      getPresentFingerprints: archive.getPresentFingerprints,
      getPresentRaw: archive.getPresentRaw,
      mutations,
      imports,
      close() {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
