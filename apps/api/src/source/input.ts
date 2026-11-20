import { createHash } from "node:crypto";
import {
  RawIncidentsSchema,
  STATE_LABELS,
  type Incident,
  type RawIncident,
  type State,
} from "@mts/contracts";

const stateEntries = Object.entries(STATE_LABELS) as [Exclude<State, "Other">, string][];
const canonicalStates = new Map<string, Exclude<State, "Other">>(stateEntries.map(([name]) => [name, name]));
const statesByLabel = new Map<string, Exclude<State, "Other">>(
  stateEntries.map(([name, label]) => [label.toLowerCase().replaceAll("ё", "е"), name]),
);

export const LIVE_FILENAME = "character_problems.json";
export const BASELINE_FILENAME = "baseline.json";

export class InvalidIncidentFile extends Error {
  constructor() {
    super("Файл должен содержать валидный массив инцидентов с уникальными ID.");
  }
}

function parseIncidentBytes(bytes: Uint8Array): { raw: Record<string, unknown>[]; normalized: RawIncident[] } {
  try {
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const parsed = RawIncidentsSchema.safeParse(raw);
    if (parsed.success) return { raw: raw as Record<string, unknown>[], normalized: parsed.data };
  } catch {
    // Raw input may contain private data. Keep parse diagnostics out of errors and logs.
  }
  throw new InvalidIncidentFile();
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
  raw: Record<string, unknown>;
  fingerprint: string;
};

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fingerprint(row: Record<string, unknown>): string {
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
  }).sort((left, right) => left.incident.id < right.incident.id ? -1 : 1);
  return {
    records,
    incidents: records.map(({ incident }) => incident),
    descriptions: records.map(({ incident, description }) => [incident.id, description]),
  };
}
