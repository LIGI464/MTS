import { randomUUID } from "node:crypto";
import type { ImportPreviewResult } from "@mts/contracts";
import { countExportRows, InvalidIncidentFile, normalizeIncidents } from "./input.js";

const previewTtlMs = 10 * 60_000;
const maxPreviews = 16;
const noChanges = { added: 0, updated: 0, archived: 0 };

type Preview = { bytes: Buffer; revision: number; expiresAt: number };

export function createImportPreviews() {
  const previews = new Map<string, Preview>();

  return {
    create(
      jsonText: string,
      expectedRevision: number,
      presentFingerprints: () => Map<string, string>,
    ): ImportPreviewResult {
      const bytes = Buffer.from(jsonText, "utf8");
      let data: ReturnType<typeof normalizeIncidents>;
      try {
        data = normalizeIncidents(bytes);
      } catch (error) {
        if (error instanceof InvalidIncidentFile) return { valid: false, errors: error.errors, ...error.counts, ...noChanges };
        if (error instanceof RangeError) {
          return { valid: false, errors: ["Слишком глубокая вложенность JSON."], ...countExportRows([]), ...noChanges };
        }
        throw error;
      }

      const previous = presentFingerprints();
      let added = 0;
      let updated = 0;
      for (const { incident, fingerprint } of data.records) {
        const before = previous.get(incident.id);
        if (before === undefined) added++;
        else if (before !== fingerprint) updated++;
        previous.delete(incident.id);
      }
      const archived = previous.size;
      const counts = countExportRows(data.records.map(({ raw }) => raw));
      const now = Date.now();
      for (const [id, preview] of previews) {
        if (preview.expiresAt <= now) previews.delete(id);
      }
      if (previews.size >= maxPreviews) previews.delete(previews.keys().next().value!);
      const previewId = randomUUID();
      previews.set(previewId, { bytes, revision: expectedRevision, expiresAt: now + previewTtlMs });
      return { valid: true, errors: [], ...counts, added, updated, archived, previewId, expectedRevision };
    },
    get(id: string): Preview | undefined {
      const preview = previews.get(id);
      if (preview && preview.expiresAt > Date.now()) return preview;
      previews.delete(id);
      return undefined;
    },
    delete: (id: string) => { previews.delete(id); },
  };
}
