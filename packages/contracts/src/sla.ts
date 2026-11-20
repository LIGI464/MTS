import type { Incident, State } from "./schemas.js";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export function isActiveState(state: State): boolean {
  return state === "Assigned" || state === "WorkInProgress";
}

export function getSlaState(
  incident: Incident,
  nowMs: number,
): "normal" | "near" | "overdue" | "unknown" | "done" {
  if (incident.state === "Resolved" || incident.state === "Closed" || incident.state === "Research") {
    return "done";
  }
  if (incident.dueAt === null) return "unknown";

  const dueMs = Date.parse(incident.dueAt);
  const createdMs = Date.parse(incident.createdAt);
  if (Number.isNaN(dueMs) || Number.isNaN(createdMs)) return "unknown";

  const remaining = dueMs - nowMs;
  const window = Math.max(0, dueMs - createdMs);
  const nearLimit = Math.min(THIRTY_MINUTES_MS, 0.2 * window);
  if (remaining <= 0) return "overdue";
  if (remaining <= nearLimit) return "near";
  return "normal";
}
