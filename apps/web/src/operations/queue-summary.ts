import { getSlaState, isActiveState, type Snapshot } from "@mts/contracts";

export type QueueFilter = "active" | "critical" | "near" | "overdue";
export type QueueSummary = Record<QueueFilter, Set<string>>;

export function summarizeQueues(snapshot: Snapshot, nowMs: number): QueueSummary {
  const result: QueueSummary = {
    active: new Set(),
    critical: new Set(snapshot.groups.critical),
    near: new Set(),
    overdue: new Set(),
  };
  const queuedIds = new Set(Object.values(snapshot.groups).flat());

  for (const incident of snapshot.incidents) {
    if (!isActiveState(incident.state) || !queuedIds.has(incident.id)) continue;
    result.active.add(incident.id);
    const sla = getSlaState(incident, nowMs);
    if (sla === "near" || sla === "overdue") result[sla].add(incident.id);
  }

  return result;
}

export function filterQueueGroups(snapshot: Snapshot, incidentIds: ReadonlySet<string>): Snapshot {
  const groups = Object.fromEntries(
    Object.entries(snapshot.groups).map(([name, ids]) => [name, ids.filter((id) => incidentIds.has(id))]),
  ) as Snapshot["groups"];
  return { ...snapshot, groups };
}
