import { COORDINATOR_TEAM, isActiveState } from "@mts/contracts";
import type { Incident, Notice, Snapshot } from "@mts/contracts";

function compareIncidents(left: Incident, right: Incident): number {
  if (left.dueAt !== right.dueAt) {
    if (left.dueAt === null) return 1;
    if (right.dueAt === null) return -1;
    return left.dueAt < right.dueAt ? -1 : 1;
  }
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function buildGroups(incidents: readonly Incident[]): Snapshot["groups"] {
  const groups: Snapshot["groups"] = {
    critical: [],
    coordinator: [],
    high: [],
    research: [],
  };
  for (const incident of incidents.toSorted(compareIncidents)) {
    const active = isActiveState(incident.state);
    const research = incident.state === "Research";
    if (active && incident.priority === 4) groups.critical.push(incident.id);
    if ((active || research) && incident.team === COORDINATOR_TEAM) {
      groups.coordinator.push(incident.id);
    }
    if (active && incident.priority === 3) groups.high.push(incident.id);
    if (research) groups.research.push(incident.id);
  }
  return groups;
}

export function diffNotices(
  previous: Snapshot | null,
  next: Pick<Snapshot, "groups" | "incidents">,
  at: string,
): Omit<Notice, "seq">[] {
  if (previous === null) return [];

  const previousCritical = new Set(previous.groups.critical);
  const previousCoordinator = new Set(previous.groups.coordinator);
  const nextCritical = new Set(next.groups.critical);
  const nextCoordinator = new Set(next.groups.coordinator);

  const notices: Omit<Notice, "seq">[] = [];
  for (const { id, state, title } of next.incidents) {
    if (nextCritical.has(id) && !previousCritical.has(id)) {
      notices.push({ kind: "critical.new", incidentId: id, title, at });
    }
    if (nextCoordinator.has(id) && !previousCoordinator.has(id)) {
      notices.push({ kind: "coordinator.assigned", incidentId: id, title, at });
    }
    if (previousCritical.has(id) && (state === "Resolved" || state === "Closed" || state === "Research")) {
      notices.push({ kind: "critical.resolved", incidentId: id, title: "Критический инцидент решён", at });
    }
  }
  return notices;
}
