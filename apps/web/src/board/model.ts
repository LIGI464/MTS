import { COORDINATOR_TEAM, type Incident, type Priority } from "@mts/contracts";

export const PRIORITIES = [
  { id: 4, title: "Критические", label: "Критический" },
  { id: 3, title: "Высокий приоритет", label: "Высокий" },
  { id: 2, title: "Средний приоритет", label: "Средний" },
  { id: 1, title: "Низкий приоритет", label: "Низкий" },
] as const;

export function uniqueIncidents(incidents: readonly Incident[]): Incident[] {
  return [...new Map(incidents.map((incident) => [incident.id, incident])).values()];
}

export function priorityQueues(incidents: readonly Incident[]): Record<Priority, Incident[]> {
  const queues: Record<Priority, Incident[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const incident of uniqueIncidents(incidents).sort(compareIncidents)) {
    queues[incident.priority].push(incident);
  }
  return queues;
}

function compareIncidents(left: Incident, right: Incident): number {
  if (left.dueAt !== right.dueAt) {
    if (left.dueAt === null) return 1;
    if (right.dueAt === null) return -1;
    return left.dueAt.localeCompare(right.dueAt);
  }
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id);
}

export function incidentCoordinator(incident: Pick<Incident, "coordinator" | "team" | "assignee">) {
  if (incident.coordinator !== undefined) return incident.coordinator;
  const name = incident.team === COORDINATOR_TEAM ? incident.assignee?.trim() : null;
  return name ? { id: name, name } : null;
}

export function displayText(value: string | null, empty: string): string {
  return value?.trim() ? value : empty;
}
