import { getSlaState, isActiveState, type Incident, type Priority, type RawIncidentFields, type State } from "@mts/contracts";
import { registrationDay } from "../board/format";
import { incidentCoordinator, uniqueIncidents } from "../board/model";

export type QuickSla = "near" | "overdue" | "noDeadline";
type CoordinatorPresence = "assigned" | "unassigned";
type Flag = "" | "yes" | "no";

export type QueueFilters = {
  search: string;
  status: "active" | "all" | State;
  priority: "" | Priority;
  sla: readonly QuickSla[];
  coordinatorPresence: readonly CoordinatorPresence[];
  coordinator: string;
  team: string;
  product: string;
  service: string;
  dateFrom: string;
  dateTo: string;
  duplicates: Flag;
  consequences: Flag;
};

export const DEFAULT_FILTERS: QueueFilters = {
  search: "", status: "active", priority: "", sla: [], coordinatorPresence: [],
  coordinator: "", team: "", product: "", service: "", dateFrom: "", dateTo: "",
  duplicates: "", consequences: "",
};

const duplicateKeys = ["isDuplicate", "duplicate", "duplicateOf", "duplicateId", "duplicateIncidentId"];
const consequencesKeys = ["isConsequenceElimination", "isEliminationOfConsequences", "consequenceElimination", "eliminationOfConsequences"];

export function needsRawFields(filters: QueueFilters): boolean {
  return Boolean(filters.duplicates || filters.consequences);
}

export function filterIncidents(incidents: readonly Incident[], filters: QueueFilters, nowMs: number): Incident[] {
  const search = filters.search.trim().toLocaleLowerCase("ru");
  return uniqueIncidents(incidents).filter((incident) => {
    if (filters.status === "active" && !isActiveState(incident.state)) return false;
    if (filters.status !== "active" && filters.status !== "all" && filters.status !== incident.state) return false;
    if (filters.priority && incident.priority !== filters.priority) return false;
    if (filters.sla.length && !filters.sla.some((key) => matchesSla(incident, key, nowMs))) return false;
    const coordinator = incidentCoordinator(incident);
    if (filters.coordinatorPresence.length &&
      !filters.coordinatorPresence.includes(coordinator ? "assigned" : "unassigned")) return false;
    if (filters.coordinator && coordinator?.id !== filters.coordinator) return false;
    if (filters.team && incident.team !== filters.team) return false;
    if (filters.product && incident.product !== filters.product) return false;
    if (filters.service && incident.service !== filters.service) return false;
    if (filters.dateFrom || filters.dateTo) {
      const date = registrationDay(incident.createdAt);
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
    }
    return !search || [incident.id, incident.title, incident.product, incident.service].some(
      (value) => value?.toLocaleLowerCase("ru").includes(search),
    );
  });
}

export function matchesRawFilters(raw: RawIncidentFields, filters: QueueFilters): boolean {
  return matchFlag(raw, duplicateKeys, filters.duplicates) && matchFlag(raw, consequencesKeys, filters.consequences);
}

function matchFlag(raw: RawIncidentFields, keys: readonly string[], choice: Flag): boolean {
  if (!choice) return true;
  const marked = keys.some((key) => {
    if (!Object.hasOwn(raw, key)) return false;
    const value = raw[key];
    if (typeof value === "string") {
      return !["", "0", "false", "нет", "null"].includes(value.trim().toLocaleLowerCase("ru"));
    }
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  });
  return marked === (choice === "yes");
}

function matchesSla(incident: Incident, key: QuickSla, nowMs: number): boolean {
  const sla = getSlaState(incident, nowMs);
  return key === "noDeadline" ? incident.dueAt === null || sla === "unknown" : sla === key;
}

export function summarizeQueues(incidents: readonly Incident[], nowMs: number) {
  const result = { active: 0, critical: 0, near: 0, overdue: 0 };
  for (const incident of uniqueIncidents(incidents)) {
    if (!isActiveState(incident.state)) continue;
    result.active++;
    if (incident.priority === 4) result.critical++;
    const sla = getSlaState(incident, nowMs);
    if (sla === "near" || sla === "overdue") result[sla]++;
  }
  return result;
}

export type QueueSummary = ReturnType<typeof summarizeQueues>;
