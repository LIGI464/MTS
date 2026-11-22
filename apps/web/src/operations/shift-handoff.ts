import { type Incident, type Snapshot } from "@mts/contracts";
import { formatMoscow } from "../board/format";
import { compareIncidents } from "../board/model";
import { ACTIVITY_LABELS, type ActivityEvent } from "./activity";
import { QUEUE_LABELS, type QueueMembers } from "./queue-summary";
import type { IncidentCluster } from "./shift-triage";

const ACTION_LIMIT = 10;
const CLUSTER_LIMIT = 5;
const MEMBER_LIMIT = 5;
const EVENT_LIMIT = 5;
const ACTION_QUEUES = ["critical", "overdue", "near", "coordinator"] as const;

type HandoffInput = {
  source: Snapshot["source"];
  revision: number;
  nowMs: number;
  sourceLabel: string;
  queues: QueueMembers;
  clusters: readonly IncidentCluster[];
  events: readonly ActivityEvent[];
};

function lineText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function createShiftHandoff({ source, revision, nowMs, sourceLabel, queues, clusters, events }: HandoffInput): string {
  const candidates = new Map<string, { incident: Incident; reasons: string[]; order: number }>();
  ACTION_QUEUES.forEach((queue, order) => {
    for (const incident of queues[queue]) {
      const reason = QUEUE_LABELS[queue].label;
      const current = candidates.get(incident.id);
      if (current) current.reasons.push(reason);
      else candidates.set(incident.id, { incident, reasons: [reason], order });
    }
  });
  const actions = [...candidates.values()].sort((a, b) => a.order - b.order
    || b.incident.priority - a.incident.priority || compareIncidents(a.incident, b.incident));
  const lines = [
    "Передача смены · Goida-board",
    `Сформировано ${formatMoscow(new Date(nowMs).toISOString())} МСК · ревизия ${revision}`,
    sourceLabel,
    ...(source.lastGoodAt ? [`Последний успешный снимок — ${formatMoscow(source.lastGoodAt)} МСК`] : []),
    "",
    `Критические — ${queues.critical.length} · У координаторов — ${queues.coordinator.length} · Срок близко — ${queues.near.length} · Просрочены — ${queues.overdue.length}`,
    "",
    `Требуют внимания (${actions.length})`,
  ];
  if (actions.length === 0) lines.push("Нет заявок в этих очередях.");
  for (const { incident, reasons } of actions.slice(0, ACTION_LIMIT)) {
    lines.push(
      `• ${lineText(incident.id)} — ${lineText(incident.title)} · ${lineText(incident.stateLabel)} · ${reasons.join(", ")}`,
      `  Команда — ${lineText(incident.team ?? "не указана")} · Координатор — ${lineText(incident.coordinator?.name ?? "не указан")} · SLA — ${incident.dueAt ? formatMoscow(incident.dueAt) + " МСК" : "срок не указан"}`,
    );
  }
  if (actions.length > ACTION_LIMIT) lines.push(`Ещё заявок — ${actions.length - ACTION_LIMIT}.`);

  lines.push("", `Возможные общие сбои (${clusters.length})`);
  if (clusters.length === 0) lines.push("Групп совпадений нет.");
  for (const { incidents } of clusters.slice(0, CLUSTER_LIMIT)) {
    const { title, product, service } = incidents[0];
    const scope = [product, service].filter((value): value is string => Boolean(value)).map(lineText).join(" / ");
    const ids = incidents.slice(0, MEMBER_LIMIT).map(({ id }) => lineText(id)).join(", ");
    const remainder = incidents.length > MEMBER_LIMIT ? ` (+${incidents.length - MEMBER_LIMIT})` : "";
    lines.push(`• ${lineText(title)} · ${scope} · ${ids}${remainder}`);
  }
  if (clusters.length > CLUSTER_LIMIT) lines.push(`Ещё групп — ${clusters.length - CLUSTER_LIMIT}.`);

  lines.push("", "Последние события");
  if (events.length === 0) lines.push("В журнале пока нет событий.");
  for (const { at, kind, incidentId, title } of events.slice(0, EVENT_LIMIT)) {
    const description = [...new Set([ACTIVITY_LABELS[kind], title, incidentId].filter(
      (value): value is string => Boolean(value),
    ).map(lineText))].join(" · ");
    lines.push(`• ${formatMoscow(at)} МСК · ${description}`);
  }
  if (events.length > EVENT_LIMIT) lines.push(`Ещё событий в журнале — ${events.length - EVENT_LIMIT}.`);
  return lines.join("\n");
}
