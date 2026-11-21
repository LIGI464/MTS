import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FullTicketDetail, HistoryEntry, RawIncidentFields, TicketList, TicketSummary } from "@mts/contracts";
import { MAX_MATCH_TEXT_LENGTH, type ArchiveMatchTicket } from "../assistant/matches.js";
import type { CoordinatorProjection } from "../source/coordinators.js";
import type { SourceRecord } from "../source/input.js";

type StoredTicket = Omit<TicketSummary, "version" | "present">;
type HistoryRow = {
  incidentId: string;
  version: string;
  at: string;
  present: 0 | 1;
  fingerprint: string;
  raw: string;
  ticket: string;
};
type SummaryRow = Pick<HistoryRow, "version" | "present" | "ticket">;
type SearchRow = Omit<ArchiveMatchTicket, "present"> & { present: HistoryRow["present"] };

function displayText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function projectTicket({ incident, raw }: SourceRecord): StoredTicket {
  const { id, title, product, service, team, assignee, state, stateLabel, priority, createdAt, dueAt, resolvedAt } = incident;
  return {
    id, title, product, service, team, assignee, state, stateLabel, priority, createdAt, dueAt, resolvedAt,
    hasSolution: displayText(raw.solution) !== null,
    coordinator: incident.coordinator,
  };
}

function readSummary(row: SummaryRow): TicketSummary {
  const ticket = JSON.parse(row.ticket) as StoredTicket;
  return { ...ticket, version: row.version, present: row.present === 1 };
}

function readSearchTicket(row: SearchRow): ArchiveMatchTicket {
  return { ...row, present: row.present === 1 };
}

export function prepareItsmArchive(database: DatabaseSync, projectCoordinator: CoordinatorProjection) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS itsm_history (
      seq INTEGER PRIMARY KEY,
      incident_id TEXT NOT NULL,
      version TEXT NOT NULL,
      at TEXT NOT NULL,
      present INTEGER NOT NULL CHECK (present IN (0, 1)),
      fingerprint TEXT NOT NULL,
      raw TEXT NOT NULL,
      ticket TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS itsm_history_incident ON itsm_history (incident_id, seq DESC);
    CREATE TABLE IF NOT EXISTS itsm_incidents (
      id TEXT PRIMARY KEY,
      latest_seq INTEGER NOT NULL REFERENCES itsm_history (seq)
    ) STRICT;
  `);

  const currentRows = database.prepare(`
    SELECT h.version, h.present, h.ticket, h.raw FROM itsm_incidents i
    JOIN itsm_history h ON h.seq = i.latest_seq ORDER BY i.id
  `);
  const presentRows = database.prepare(`
    SELECT i.id AS incidentId, h.fingerprint, h.raw, h.ticket FROM itsm_incidents i
    JOIN itsm_history h ON h.seq = i.latest_seq WHERE h.present = 1 ORDER BY i.id
  `);
  const presentFingerprints = database.prepare(`
    SELECT i.id, h.fingerprint FROM itsm_incidents i
    JOIN itsm_history h ON h.seq = i.latest_seq WHERE h.present = 1
  `);
  const currentVersion = database.prepare(`
    SELECT h.version, h.present FROM itsm_incidents i JOIN itsm_history h ON h.seq = i.latest_seq WHERE i.id = ?
  `);
  const searchProjection = `
    SELECT i.id, h.version, h.present,
      substr(json_extract(h.ticket, '$.title'), 1, ${MAX_MATCH_TEXT_LENGTH}) AS title,
      substr(json_extract(h.ticket, '$.product'), 1, ${MAX_MATCH_TEXT_LENGTH}) AS product,
      substr(json_extract(h.ticket, '$.service'), 1, ${MAX_MATCH_TEXT_LENGTH}) AS service,
      json_extract(h.ticket, '$.state') AS state,
      json_extract(h.ticket, '$.resolvedAt') AS resolvedAt,
      substr(json_extract(h.raw, '$.shortDescription'), 1, ${MAX_MATCH_TEXT_LENGTH}) AS shortDescription,
      substr(json_extract(h.raw, '$.description'), 1, ${MAX_MATCH_TEXT_LENGTH}) AS description,
      CASE WHEN json_type(h.raw, '$.solution') = 'text'
        THEN substr(json_extract(h.raw, '$.solution'), 1, ${MAX_MATCH_TEXT_LENGTH}) END AS solution,
      json_extract(h.raw, '$.sysId') AS sysId
    FROM itsm_incidents i JOIN itsm_history h ON h.seq = i.latest_seq
  `;
  const searchTicket = database.prepare(`${searchProjection} WHERE i.id = ?`);
  const completedSearchTickets = database.prepare(`
    ${searchProjection} WHERE json_extract(h.ticket, '$.state') IN ('Resolved', 'Closed')
  `);
  const historyRows = database.prepare(`
    SELECT version, at, present, raw, ticket FROM itsm_history
    WHERE incident_id = ? ORDER BY seq DESC
  `);
  const appendHistory = database.prepare(`
    INSERT INTO itsm_history (incident_id, version, at, present, fingerprint, raw, ticket)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateCurrent = database.prepare(`
    INSERT INTO itsm_incidents (id, latest_seq) VALUES (?, ?)
    ON CONFLICT (id) DO UPDATE SET latest_seq = excluded.latest_seq
  `);
  type RecordData = Pick<HistoryRow, "incidentId" | "fingerprint" | "raw" | "ticket">;

  function append(record: RecordData, at: string, present: 0 | 1): void {
    const { incidentId, fingerprint, raw, ticket } = record;
    const { lastInsertRowid } = appendHistory.run(incidentId, randomUUID(), at, present, fingerprint, raw, ticket);
    updateCurrent.run(incidentId, lastInsertRowid);
  }

  return {
    getPresentFingerprints(): Map<string, string> {
      const rows = presentFingerprints.all() as { id: string; fingerprint: string }[];
      return new Map(rows.map(({ id, fingerprint }) => [id, fingerprint]));
    },
    getPresentRaw(): Map<string, RawIncidentFields> {
      return new Map((presentRows.all() as RecordData[]).map(({ incidentId, raw }) => [incidentId, JSON.parse(raw) as RawIncidentFields]));
    },
    // Called within the same write transaction as the dashboard snapshot.
    sync(records: readonly SourceRecord[], at: string): boolean {
      const previous = new Map((presentRows.all() as RecordData[]).map((row) => [row.incidentId, row]));
      let changed = false;
      for (const record of records) {
        const incidentId = record.incident.id;
        const prior = previous.get(incidentId);
        previous.delete(incidentId);
        // A projection correction must keep the version of the same accepted source record.
        if (prior?.fingerprint === record.fingerprint) continue;
        append({
          incidentId,
          fingerprint: record.fingerprint,
          raw: JSON.stringify(record.raw),
          ticket: JSON.stringify(projectTicket(record)),
        }, at, 1);
        changed = true;
      }
      for (const missing of previous.values()) append(missing, at, 0);
      return changed || previous.size > 0;
    },
    listTickets(): TicketList {
      return { items: (currentRows.all() as (SummaryRow & Pick<HistoryRow, "raw">)[]).map((row) => ({
        ...readSummary(row), coordinator: projectCoordinator(JSON.parse(row.raw) as RawIncidentFields),
      })) };
    },
    getSearchTicket(id: string): ArchiveMatchTicket | null {
      const row = searchTicket.get(id) as SearchRow | undefined;
      return row ? readSearchTicket(row) : null;
    },
    *completedSearchTickets(): IterableIterator<ArchiveMatchTicket> {
      for (const row of completedSearchTickets.iterate() as Iterable<SearchRow>) yield readSearchTicket(row);
    },
    getVersion(id: string): { version: string; present: boolean } | null {
      const row = currentVersion.get(id) as Pick<SummaryRow, "version" | "present"> | undefined;
      return row ? { version: row.version, present: row.present === 1 } : null;
    },
    getTicket(id: string): FullTicketDetail | null {
      const rows = historyRows.all(id) as (SummaryRow & Pick<HistoryRow, "raw" | "at">)[];
      if (rows.length === 0) return null;

      const tickets = rows.map((row) => {
        const rawFields = JSON.parse(row.raw) as RawIncidentFields;
        return {
          ticket: readSummary(row),
          at: row.at,
          description: displayText(rawFields.description),
          solution: displayText(rawFields.solution),
          rawFields,
        };
      });
      const [{ ticket, description, solution, rawFields }] = tickets;
      const history = tickets.map(({ ticket, at, description, solution }): HistoryEntry => {
        const { version, present, stateLabel, team, coordinator, dueAt, priority } = ticket;
        return { version, at, present, stateLabel, team, coordinator, dueAt, priority, description, solution };
      });
      return { ticket: { ...ticket, coordinator: projectCoordinator(rawFields) }, description, solution, history, rawFields };
    },
  };
}
