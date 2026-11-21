import { z } from "zod";
import { IncidentSchema, type Incident, type Snapshot } from "./schemas.js";
import { getSlaState, isActiveState } from "./sla.js";

export const INCIDENT_DESCRIPTION_LIMIT = 280;
export const NO_INCIDENT_DESCRIPTION = "В заявке нет описания симптомов";

const identity = {
  incidentId: IncidentSchema.shape.id,
  incidentVersion: IncidentSchema.shape.version,
};
const summaryText = z.string().trim().min(1).max(INCIDENT_DESCRIPTION_LIMIT);
const queue = z.enum(["critical", "coordinator", "near", "overdue", "high", "medium", "low"]);

const recommendation = z.strictObject({
  ...identity,
  rank: z.number().int().positive(),
  reason: summaryText,
  target: queue,
  title: IncidentSchema.shape.title,
  state: IncidentSchema.shape.state,
  stateLabel: IncidentSchema.shape.stateLabel,
  priority: IncidentSchema.shape.priority,
  dueAt: IncidentSchema.shape.dueAt,
  sla: z.enum(["normal", "near", "overdue", "unknown", "done"]),
});

const description = z.strictObject({ ...identity, text: summaryText });

export const PriorityFeedSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  resetSequence: z.number().int().nonnegative().nullable(),
  evaluatedAt: IncidentSchema.shape.createdAt,
  source: z.enum(["llm", "rules"]),
  fallback: z.enum(["provider_error", "invalid_output", "timeout"]).nullable(),
  recommendations: z.array(recommendation),
  descriptions: z.array(description),
}).refine(({ recommendations }) =>
  recommendations.every(({ rank }, index) => rank === index + 1) &&
  new Set(recommendations.map(({ incidentId }) => incidentId)).size === recommendations.length,
"Ожидаются уникальные рекомендации в порядке ранга").refine(({ descriptions }) =>
  new Set(descriptions.map(({ incidentId }) => incidentId)).size === descriptions.length,
"Ожидается одно описание на заявку").refine(({ source, fallback }) =>
  source === "rules" || fallback === null, "Ожидается согласованный источник расчёта");

export type PriorityFeed = z.infer<typeof PriorityFeedSchema>;
export type PriorityRecommendation = z.infer<typeof recommendation>;
export type IncidentDescription = z.infer<typeof description>;

const priorityQueues = { 1: "low", 2: "medium", 3: "high", 4: "critical" } as const;
type QueueMembership = {
  critical: ReadonlySet<string>;
  coordinator: ReadonlySet<string>;
};

export function priorityQueueMembership(groups: Snapshot["groups"]): QueueMembership {
  return { critical: new Set(groups.critical), coordinator: new Set(groups.coordinator) };
}

export function priorityTarget(
  incident: Incident, groups: QueueMembership, sla: PriorityRecommendation["sla"],
): PriorityRecommendation["target"] | null {
  if (incident.state === "Research") return groups.coordinator.has(incident.id) ? "coordinator" : null;
  if (!isActiveState(incident.state)) return null;
  if (groups.critical.has(incident.id)) return "critical";
  if (sla === "near" || sla === "overdue") return sla;
  if (groups.coordinator.has(incident.id)) return "coordinator";
  return incident.priority === 4 ? null : priorityQueues[incident.priority];
}

export function matchesPriorityRecommendation(
  entry: PriorityRecommendation,
  incident: Incident | undefined,
  groups: QueueMembership,
  nowMs: number,
): boolean {
  if (incident?.id !== entry.incidentId || incident.version !== entry.incidentVersion) return false;
  const sla = getSlaState(incident, nowMs);
  return entry.title === incident.title && entry.state === incident.state && entry.stateLabel === incident.stateLabel &&
    entry.priority === incident.priority && entry.dueAt === incident.dueAt && entry.sla === sla &&
    entry.target === priorityTarget(incident, groups, sla);
}

export function priorityResetSequence(snapshot: Snapshot): number | null {
  return snapshot.notices.findLast(({ kind }) => kind === "demo.reset")?.seq ?? null;
}

export function prioritySlaKey(incidents: readonly Incident[], nowMs: number): string {
  return incidents.map((incident) => {
    const sla = getSlaState(incident, nowMs);
    return sla === "near" ? "1" : sla === "overdue" ? "2" : "0";
  }).join("");
}
