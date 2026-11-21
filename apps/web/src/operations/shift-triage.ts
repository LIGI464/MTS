import { getSlaState, isActiveState, type Incident } from "@mts/contracts";
import { uniqueIncidents } from "../board/model";

export const CLUSTER_WINDOW_MINUTES = 90;
const CLUSTER_WINDOW_MS = CLUSTER_WINDOW_MINUTES * 60_000;

export type IncidentCluster = {
  id: string;
  incidents: readonly [Incident, Incident, ...Incident[]];
  priority: Incident["priority"];
};

function normalize(value: string | null): string {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function findIncidentClusters(incidents: readonly Incident[]): IncidentCluster[] {
  const buckets = new Map<string, Incident[]>();
  for (const incident of uniqueIncidents(incidents)) {
    if (!isActiveState(incident.state)) continue;
    const product = normalize(incident.product);
    const service = normalize(incident.service);
    const title = normalize(incident.title);
    if ((!product && !service) || !title) continue;
    const key = JSON.stringify([product, service, title]);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(incident);
    else buckets.set(key, [incident]);
  }

  const clusters: IncidentCluster[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    let start = 0;
    while (start < bucket.length - 1) {
      const first = bucket[start];
      const until = Date.parse(first.createdAt) + CLUSTER_WINDOW_MS;
      let end = start + 1;
      let priority = first.priority;
      while (end < bucket.length && Date.parse(bucket[end].createdAt) <= until) {
        if (bucket[end].priority > priority) priority = bucket[end].priority;
        end++;
      }
      if (end - start > 1) {
        clusters.push({ id: first.id, priority, incidents: [first, bucket[start + 1], ...bucket.slice(start + 2, end)] });
      }
      start = end;
    }
  }
  return clusters.sort((a, b) => b.priority - a.priority || b.incidents.length - a.incidents.length
    || b.incidents[0].createdAt.localeCompare(a.incidents[0].createdAt) || a.id.localeCompare(b.id));
}

export type TeamWorkload = { team: string; active: number; near: number; overdue: number };

export function countTeamWorkload(
  incidents: readonly Incident[], team: string, nowMs: number,
): TeamWorkload {
  const workload = { team, active: 0, near: 0, overdue: 0 };
  for (const incident of uniqueIncidents(incidents)) {
    if (incident.team !== team || !isActiveState(incident.state)) continue;
    workload.active++;
    const sla = getSlaState(incident, nowMs);
    if (sla === "near" || sla === "overdue") workload[sla]++;
  }
  return workload;
}
