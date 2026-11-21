import { createHash } from "node:crypto";
import {
  RawIncidentsSchema,
  STATE_LABELS,
  readExportPriority,
  type Incident,
  type RawIncident,
  type RawIncidentFields,
  type State,
} from "@mts/contracts";

const stateEntries = Object.entries(STATE_LABELS) as [Exclude<State, "Other">, string][];
const canonicalStates = new Map<string, Exclude<State, "Other">>(stateEntries.map(([name]) => [name, name]));
const statesByLabel = new Map<string, Exclude<State, "Other">>(
  stateEntries.map(([name, label]) => [label.toLowerCase().replaceAll("ё", "е"), name]),
);

export const LIVE_FILENAME = "character_problems.json";
export const BASELINE_FILENAME = "baseline.json";

export function countExportRows(rows: readonly unknown[]) {
  const byPriority = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const priority = readExportPriority(row as Record<string, unknown>);
    if (priority !== undefined) byPriority[priority]++;
  }
  return { total: rows.length, byPriority };
}

export class InvalidIncidentFile extends Error {
  readonly counts: ReturnType<typeof countExportRows>;

  constructor(readonly errors: string[], rows: readonly unknown[] = []) {
    super("Файл должен содержать валидный массив инцидентов с уникальными ID.");
    this.counts = countExportRows(rows);
  }
}

function parseIncidentBytes(bytes: Uint8Array): { raw: RawIncidentFields[]; normalized: RawIncident[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new InvalidIncidentFile(["Файл не содержит корректный JSON."]);
  }
  if (!Array.isArray(raw)) throw new InvalidIncidentFile(["В файле ожидается массив заявок."]);

  const parsed = RawIncidentsSchema.safeParse(raw);
  if (parsed.success) return { raw: raw as RawIncidentFields[], normalized: parsed.data };

  // Show field locations without exposing values from the upload or the JSON parser's source excerpts.
  const issues = parsed.error.issues;
  const errors = issues.slice(0, 20).map(({ path, code }) => {
    const [index, field] = path;
    const location = typeof index === "number" ? `Запись ${index + 1}` : "Файл";
    if (typeof field !== "string") return `${location}: ожидается объект заявки.`;
    const reason = field === "id" && code === "custom" ? "ID уже встречался в файле" : "некорректное значение";
    return `${location}, поле ${field}: ${reason}.`;
  });
  if (issues.length > errors.length) errors.push(`Всего ошибок: ${issues.length}.`);
  throw new InvalidIncidentFile(errors, raw);
}

export function readIncidentBytes(bytes: Uint8Array): RawIncident[] {
  return parseIncidentBytes(bytes).normalized;
}

export function incidentState(raw: RawIncident): State {
  const name = raw.stateEnum?.trim();
  if (name) return canonicalStates.get(name) ?? "Other";
  const label = raw.state?.toLowerCase().replaceAll("ё", "е");
  return label ? statesByLabel.get(label) ?? "Other" : "Other";
}

function itsmUrl(template: string | undefined, raw: RawIncident): string | null {
  if (!template || !/\{(?:id|sysId)\}/.test(template)) return null;
  if (template.includes("{sysId}") && !raw.sysId?.trim()) return null;
  try {
    const url = new URL(template.replace(/\{(id|sysId)\}/g, (match) =>
      encodeURIComponent(match === "{id}" ? raw.id : raw.sysId!),
    ));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export type NormalizedIncidents = {
  incidents: Incident[];
  descriptions: [string, string | null][];
  records: SourceRecord[];
};

export type SourceRecord = {
  incident: Incident;
  description: string | null;
  raw: RawIncidentFields;
  fingerprint: string;
};

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprint(row: Record<string, unknown>): string {
  return sha256(JSON.stringify(row, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  }));
}

export function normalizeIncidents(bytes: Uint8Array, itsmTemplate?: string): NormalizedIncidents {
  const { raw: original, normalized } = parseIncidentBytes(bytes);
  const records = normalized.map((raw, index): SourceRecord => {
    const state = incidentState(raw);
    const description = raw.description ?? null;
    const card: Omit<Incident, "version"> = {
      id: raw.id,
      title: raw.header ?? raw.id,
      product: raw.productName ?? null,
      service: raw.service ?? null,
      team: raw.assignedGroupName ?? null,
      assignee: raw.assignedEmployee ?? null,
      state,
      stateLabel: state === "Other" ? raw.state ?? (raw.stateEnum?.trim() || "Другой") : STATE_LABELS[state],
      priority: raw.priorityId,
      urgency: raw.urgencyId ?? null,
      impact: raw.impactId ?? null,
      createdAt: raw.submitDate,
      dueAt: raw.deadline ?? null,
      resolvedAt: raw.completionDate ?? null,
      summary: raw.shortDescription ?? (description === null ? null : Array.from(description).slice(0, 280).join("")),
      itsmUrl: itsmUrl(itsmTemplate, raw),
    };
    return {
      incident: { ...card, version: sha256(JSON.stringify([card, description])) },
      description,
      raw: original[index],
      fingerprint: fingerprint(original[index]),
    };
  });
  const sorted = records.toSorted((left, right) => left.incident.id < right.incident.id ? -1 : 1);
  return {
    records,
    incidents: sorted.map(({ incident }) => incident),
    descriptions: sorted.map(({ incident, description }) => [incident.id, description]),
  };
}
