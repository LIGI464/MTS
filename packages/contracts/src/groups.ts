import { COORDINATOR_TEAM } from "./constants.js";
import type { GroupKey, Incident } from "./schemas.js";
import { isActiveState } from "./sla.js";

export function groupIncidentIds(incidents: readonly Incident[]): Record<GroupKey, string[]> {
  const grouped: Record<GroupKey, Incident[]> = {
    critical: [],
    coordinator: [],
    high: [],
    research: [],
  };

  for (const incident of incidents) {
    if (incident.priority === 4 && isActiveState(incident.state)) grouped.critical.push(incident);
    if (
      incident.team === COORDINATOR_TEAM &&
      (isActiveState(incident.state) || incident.state === "Research")
    ) {
      grouped.coordinator.push(incident);
    }
    if (incident.priority === 3 && isActiveState(incident.state)) grouped.high.push(incident);
    if (incident.state === "Research") grouped.research.push(incident);
  }

  return {
    critical: sortIncidents(grouped.critical).map((incident) => incident.id),
    coordinator: sortIncidents(grouped.coordinator).map((incident) => incident.id),
    high: sortIncidents(grouped.high).map((incident) => incident.id),
    research: sortIncidents(grouped.research).map((incident) => incident.id),
  };
}

function sortIncidents(incidents: readonly Incident[]): Incident[] {
  return [...incidents].sort((left, right) => {
    if (left.dueAt === null && right.dueAt !== null) return 1;
    if (left.dueAt !== null && right.dueAt === null) return -1;
    if (left.dueAt !== null && right.dueAt !== null && left.dueAt !== right.dueAt) {
      return left.dueAt < right.dueAt ? -1 : 1;
    }
    if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
  });
}
