import { DatabaseSync } from "node:sqlite";
import { IncidentSchema, NoticeSchema, type Coordinator, type Incident, type MutationResult, type Notice } from "@mts/contracts";
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
export type DashboardMutation = PendingMutation & { coordinator?: Coordinator };
type SaveOptions = {
  dashboardChanged?: boolean;
  refreshSource?: boolean;
  reset?: boolean;
  mutation?: DashboardMutation;
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
  listPresentRaw: ReturnType<typeof prepareItsmArchive>["listPresentRaw"];
  getCoordinatorAssignments: ReturnType<typeof prepareItsmArchive>["getCoordinatorAssignments"];
  mutations: Omit<ReturnType<typeof prepareMutationJournal>, "finish">;
  imports: Omit<ReturnType<typeof prepareImportJournal>, "finish">;
  close(): void;
};

function isDescriptionEntry(value: unknown): value is [string, string | null] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string"
    && (typeof value[1] === "string" || value[1] === null);
}

export function openDashboardStore(path: string): DashboardStore {
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
        at TEXT NOT NULL
      ) STRICT;
    `);
    const archive = prepareItsmArchive(database);
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
      INSERT INTO notices (kind, incident_id, title, at) VALUES (?, ?, ?, ?)
    `);
    const readNotices = database.prepare(`
      SELECT seq, kind, incident_id AS incidentId, title, at FROM (
        SELECT seq, kind, incident_id, title, at FROM notices ORDER BY seq DESC LIMIT 50
      ) ORDER BY seq
    `);
    const trimNotices = database.prepare(`
      DELETE FROM notices WHERE seq <= (SELECT seq FROM notices ORDER BY seq DESC LIMIT 1 OFFSET 500)
    `);
    const noticeList = NoticeSchema.array();
    const incidentList = IncidentSchema.array();

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
          return {
            revision,
            lastGoodAt,
            incidents: incidentList.parse(JSON.parse(incidents)),
            descriptions: entries,
            notices: noticeList.parse(readNotices.all()),
          };
        });
      },
      save(state, events, { dashboardChanged, refreshSource, reset, mutation, importRequestId }) {
        return transaction("BEGIN IMMEDIATE", () => {
          const { lastGoodAt, incidents, descriptions, records } = state;
          if (mutation?.coordinator) {
            // This mutation has only SQLite writes, so the receipt can be committed in the same transaction.
            mutations.begin(mutation);
            archive.assignCoordinator(mutation.id, mutation.coordinator);
          }
          const archiveChanged = archive.sync(records, lastGoodAt);
          const changed = Boolean(dashboardChanged || archiveChanged || reset);
          if (!changed && !refreshSource && !mutation && !importRequestId) return null;

          const revision = state.revision + Number(changed);
          writeDashboard.run(revision, lastGoodAt, JSON.stringify(incidents), JSON.stringify(descriptions));
          if (reset) database.exec("DELETE FROM notices");
          for (const { kind, incidentId, title, at } of events) {
            appendNotice.run(kind, incidentId, title, at);
          }
          trimNotices.run();
          const result: SaveResult = { revision, notices: noticeList.parse(readNotices.all()) };
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
      listPresentRaw: archive.listPresentRaw,
      getCoordinatorAssignments: archive.getCoordinatorAssignments,
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
