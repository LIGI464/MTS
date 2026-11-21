import type { DatabaseSync } from "node:sqlite";
import type { MutationResult } from "@mts/contracts";

export type PendingMutation = {
  requestId: string;
  fingerprint: string;
  id: string;
  targetFingerprint: string;
};

export function prepareMutationJournal(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS itsm_mutations (
      request_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      incident_id TEXT NOT NULL,
      target_fingerprint TEXT NOT NULL,
      version TEXT,
      revision INTEGER,
      CHECK ((version IS NULL AND revision IS NULL) OR (version IS NOT NULL AND revision IS NOT NULL AND revision >= 0))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS itsm_one_pending_mutation ON itsm_mutations ((1)) WHERE version IS NULL;
  `);
  const pending = database.prepare(`
    SELECT request_id AS requestId, fingerprint, incident_id AS id, target_fingerprint AS targetFingerprint
    FROM itsm_mutations WHERE version IS NULL
  `);
  const completed = database.prepare(`
    SELECT fingerprint, incident_id AS id, version, revision
    FROM itsm_mutations WHERE request_id = ? AND version IS NOT NULL
  `);
  const begin = database.prepare(`
    INSERT INTO itsm_mutations (request_id, fingerprint, incident_id, target_fingerprint) VALUES (?, ?, ?, ?)
  `);
  const finish = database.prepare(`
    UPDATE itsm_mutations SET version = ?, revision = ? WHERE request_id = ? AND version IS NULL
  `);
  const discard = database.prepare(`DELETE FROM itsm_mutations WHERE request_id = ? AND version IS NULL`);

  return {
    getPending(): PendingMutation | undefined {
      return pending.get() as PendingMutation | undefined;
    },
    getCompleted(requestId: string): { fingerprint: string; result: MutationResult } | undefined {
      const row = completed.get(requestId) as (MutationResult & { fingerprint: string }) | undefined;
      if (!row) return undefined;
      const { fingerprint, ...result } = row;
      return { fingerprint, result };
    },
    begin({ requestId, fingerprint, id, targetFingerprint }: PendingMutation): void {
      begin.run(requestId, fingerprint, id, targetFingerprint);
    },
    finish(requestId: string, { version, revision }: MutationResult): void {
      if (finish.run(version, revision, requestId).changes !== 1) throw new Error("Запись операции отсутствует.");
    },
    discard(requestId: string): void {
      discard.run(requestId);
    },
  };
}
