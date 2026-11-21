import type { DatabaseSync } from "node:sqlite";
import type { ImportApplyResult } from "@mts/contracts";

export type PendingImport = { requestId: string; fingerprint: string; targetDigest: string };

export function prepareImportJournal(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS incident_imports (
      request_id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      target_digest TEXT NOT NULL,
      revision INTEGER CHECK (revision >= 0)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending_incident_import ON incident_imports ((1)) WHERE revision IS NULL;
  `);
  const pending = database.prepare(`
    SELECT request_id AS requestId, fingerprint, target_digest AS targetDigest
    FROM incident_imports WHERE revision IS NULL
  `);
  const completed = database.prepare(`
    SELECT fingerprint, revision FROM incident_imports WHERE request_id = ? AND revision IS NOT NULL
  `);
  const begin = database.prepare(`
    INSERT INTO incident_imports (request_id, fingerprint, target_digest) VALUES (?, ?, ?)
  `);
  const finish = database.prepare(`
    UPDATE incident_imports SET revision = ? WHERE request_id = ? AND revision IS NULL
  `);
  const discard = database.prepare(`DELETE FROM incident_imports WHERE request_id = ? AND revision IS NULL`);

  return {
    getPending(): PendingImport | undefined {
      return pending.get() as PendingImport | undefined;
    },
    getCompleted(requestId: string): { fingerprint: string; result: ImportApplyResult } | undefined {
      const row = completed.get(requestId) as (ImportApplyResult & { fingerprint: string }) | undefined;
      if (!row) return undefined;
      return { fingerprint: row.fingerprint, result: { revision: row.revision } };
    },
    begin({ requestId, fingerprint, targetDigest }: PendingImport): void {
      begin.run(requestId, fingerprint, targetDigest);
    },
    finish(requestId: string, revision: number): void {
      if (finish.run(revision, requestId).changes !== 1) throw new Error("Запись импорта отсутствует.");
    },
    discard(requestId: string): void {
      discard.run(requestId);
    },
  };
}
