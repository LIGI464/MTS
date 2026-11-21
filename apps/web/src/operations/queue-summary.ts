import { getSlaState, isActiveState, type Incident, type Priority, type RawIncidentFields, type Snapshot, type State } from "@mts/contracts";
import { registrationDay } from "../board/format";
import { compareIncidents, incidentCoordinator, PRIORITIES, priorityQueues, uniqueIncidents } from "../board/model";
import type { IconName } from "../icons";

export const PRIMARY_QUEUES = ["critical", "coordinator"] as const;
export const SLA_QUEUES = ["near", "overdue"] as const;
export const PRIORITY_QUEUES = ["high", "medium", "low"] as const;
export const SUMMARY_SEGMENTS = [...SLA_QUEUES, ...PRIORITY_QUEUES] as const;
export type QueueCategory = (typeof PRIMARY_QUEUES)[number] | (typeof SUMMARY_SEGMENTS)[number];

export const QUEUE_LABELS = {
  critical: { label: PRIORITIES[0].title, icon: "shield-exclamation" },
  coordinator: { label: "У координаторов", icon: "people" },
  near: { label: "Срок близко", icon: "alarm" },
  overdue: { label: "Просрочены", icon: "clock-history" },
  high: { label: PRIORITIES[1].title, icon: "chevron-double-up" },
  medium: { label: PRIORITIES[2].title, icon: "dash-lg" },
  low: { label: PRIORITIES[3].title, icon: "chevron-down" },
} satisfies Record<QueueCategory, { label: string; icon: IconName }>;

export const queueId = (category: QueueCategory) => `queue-${category}`;

export type QuickSla = "near" | "overdue" | "noDeadline";
type CoordinatorPresence = "assigned" | "unassigned";
type Flag = "" | "yes" | "no";

export type QueueFilters = {
  search: string;
  status: "default" | "active" | "all" | State;
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
  search: "", status: "default", priority: "", sla: [], coordinatorPresence: [],
  coordinator: "", team: "", product: "", service: "", dateFrom: "", dateTo: "",
  duplicates: "", consequences: "",
};

const duplicateKeys = ["isDuplicate", "duplicate", "duplicateOf", "duplicateId", "duplicateIncidentId"];
const consequencesKeys = ["isConsequenceElimination", "isEliminationOfConsequences", "consequenceElimination", "eliminationOfConsequences"];

export function needsRawFields(filters: QueueFilters): boolean {
  return Boolean(filters.duplicates || filters.consequences);
}

export function filterIncidents(
  incidents: readonly Incident[], filters: QueueFilters, nowMs: number, coordinatorIds?: ReadonlySet<string>,
): Incident[] {
  const search = filters.search.trim().toLocaleLowerCase("ru");
  return uniqueIncidents(incidents).filter((incident) => {
    if (filters.status === "default") {
      if (!isActiveState(incident.state) && !coordinatorIds?.has(incident.id)) return false;
    } else if (filters.status === "active") {
      if (!isActiveState(incident.state)) return false;
    } else if (filters.status !== "all" && filters.status !== incident.state) return false;
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

export type QueueMembers = Record<QueueCategory, Incident[]>;

export function buildQueues(
  incidents: readonly Incident[], groups: Pick<Snapshot["groups"], "critical" | "coordinator">,
  nowMs: number, includeInactivePriorities = false,
): QueueMembers {
  const byId = new Map(incidents.map((incident) => [incident.id, incident]));
  const active = [...byId.values()].filter(({ state }) => isActiveState(state));
  const priorities = priorityQueues(includeInactivePriorities ? incidents : active);
  const membersOf = (ids: readonly string[]) => Array.from(new Set(ids)).flatMap((id) => byId.get(id) ?? []);
  const queues: QueueMembers = {
    critical: includeInactivePriorities ? priorities[4] : membersOf(groups.critical),
    coordinator: membersOf(groups.coordinator),
    near: [], overdue: [], high: priorities[3], medium: priorities[2], low: priorities[1],
  };
  for (const incident of active.sort(compareIncidents)) {
    const sla = getSlaState(incident, nowMs);
    if (sla === "near" || sla === "overdue") queues[sla].push(incident);
  }
  return queues;
}
