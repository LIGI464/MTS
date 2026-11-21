import {
  INCIDENT_DESCRIPTION_LIMIT, NO_INCIDENT_DESCRIPTION, PriorityFeedSchema, getSlaState,
  priorityQueueMembership, priorityResetSequence, priorityTarget,
  type Incident, type PriorityFeed, type PriorityRecommendation, type Snapshot,
} from "@mts/contracts";
import { cleanText, limitText } from "./rules.js";

const sentences = new Intl.Segmenter("ru", { granularity: "sentence" });
const deadlineTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
});
const blocking = /(?:не (?:мо[гж]\p{L}+|уда[её]тся) |недоступ\p{L}*|блокир\p{L}*|невозмож\p{L}*|остан[оа]в\p{L}*)/iu;
const widespread = /(?:масс[оа]в\p{L}*|(?:все|всех|всем|несколько|многие) (?:клиент\p{L}*|оператор\p{L}*|пользовател\p{L}*|филиал\p{L}*|регион\p{L}*))/iu;
const investigation = /(?:нужно|необходимо|требуется|предстоит) (?:проверить|уточнить|сверить|подтвердить|выяснить|воспроизвести|провести)/iu;
const priorityWeight = { 1: 0, 2: 10, 3: 32, 4: 85 };
const researchReason = "В заявке на исследование указана проверка, которую должен выполнить координатор.";

export type PriorityFacts = {
  title: string;
  symptom: string;
  details: string;
};

export type IncidentAnnotation = {
  description: string | null;
  blocked: boolean;
  widespread: boolean;
};

function normalizedFact(value: string | null, limit: number): string {
  return limitText(cleanText(value ?? "")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "")
    .replace(/(?<![\p{L}\d])(?:pass(?:word)?|пароль|токен|token|api[_ -]?key)\s*[:=]\s*\S+/giu, "")
    .replace(/\s+/gu, " ").trim(), limit);
}

export function preparePriorityFacts(incident: Incident, details: string | null): PriorityFacts {
  const title = normalizedFact(incident.title, INCIDENT_DESCRIPTION_LIMIT);
  const symptom = normalizedFact(incident.summary, INCIDENT_DESCRIPTION_LIMIT);
  const full = normalizedFact(details, 800);
  return { title, symptom, details: full === symptom ? "" : full };
}

export function describeIncident(facts: PriorityFacts): string {
  const value = facts.symptom || facts.details;
  const text = Array.from(sentences.segment(value), ({ segment }) => segment).slice(0, 3).join("").trim();
  if (!text) return NO_INCIDENT_DESCRIPTION;
  if (text.length <= INCIDENT_DESCRIPTION_LIMIT) return text;
  const prefix = limitText(text, INCIDENT_DESCRIPTION_LIMIT - 1);
  const wordEnd = prefix.lastIndexOf(" ");
  return `${wordEnd > INCIDENT_DESCRIPTION_LIMIT / 2 ? prefix.slice(0, wordEnd) : prefix}…`;
}

export function buildPriorityFeed(
  snapshot: Snapshot,
  nowMs: number,
  facts: ReadonlyMap<string, PriorityFacts>,
  annotations?: ReadonlyMap<string, IncidentAnnotation>,
  fallback: PriorityFeed["fallback"] = null,
): PriorityFeed {
  const groups = priorityQueueMembership(snapshot.groups);
  const incidents = [...new Map(snapshot.incidents.map((incident) => [incident.id, incident])).values()];
  const ranked = incidents.flatMap((incident) => {
    const sla = getSlaState(incident, nowMs);
    const target = priorityTarget(incident, groups, sla);
    if (!target) return [];
    const entry = facts.get(incident.id) ?? preparePriorityFacts(incident, null);
    const annotation = fallback ? undefined : annotations?.get(incident.id);
    const reason = urgency(incident, sla, entry, annotation, groups.coordinator.has(incident.id));
    if (!reason) return [];
    const { id: incidentId, version: incidentVersion, title, state, stateLabel, priority, dueAt } = incident;
    return [{ incidentId, incidentVersion, title, state, stateLabel, priority, dueAt, sla, target, ...reason }];
  }).sort((a, b) => b.score - a.score ||
    (a.dueAt ?? "\uffff").localeCompare(b.dueAt ?? "\uffff") || compareId(a.incidentId, b.incidentId));

  return PriorityFeedSchema.parse({
    revision: snapshot.revision,
    resetSequence: priorityResetSequence(snapshot),
    evaluatedAt: new Date(nowMs).toISOString(),
    source: annotations && annotations.size && !fallback ? "llm" : "rules",
    fallback,
    recommendations: ranked.map(({ score: _score, ...entry }, index) => ({ ...entry, rank: index + 1 })),
    descriptions: incidents.map((incident) => ({
      incidentId: incident.id,
      incidentVersion: incident.version,
      text: annotations?.get(incident.id)?.description ??
        describeIncident(facts.get(incident.id) ?? preparePriorityFacts(incident, null)),
    })),
  });
}

function urgency(
  incident: Incident, sla: PriorityRecommendation["sla"], facts: PriorityFacts,
  annotation: IncidentAnnotation | undefined, coordinated: boolean,
): { score: number; reason: string } | null {
  const evidence = [facts.title, facts.symptom, facts.details].join(" ");
  if (incident.state === "Research") {
    return investigation.test(evidence) ? { score: 29, reason: researchReason } : null;
  }

  const blocked = blocking.test(evidence) || annotation?.blocked;
  const broad = widespread.test(evidence) || annotation?.widespread;
  const highImpact = (incident.impact ?? 0) >= 3;
  const urgent = (incident.urgency ?? 0) >= 3;
  const assignedToOperator = coordinated && incident.state === "Assigned";
  const needsHandoff = incident.state === "Assigned" && !incident.assignee?.trim() && !incident.team?.trim();
  const deadline = incident.dueAt ? deadlineTime.format(new Date(incident.dueAt)) : "";
  const factors = [
    [blocked ? 53 : 0, "Из-за сбоя операция недоступна и не может быть завершена."],
    [broad ? 29 : 0, "Заявка сообщает о сбое у нескольких пользователей или в нескольких точках."],
    [sla === "overdue" ? 39 : 0, `Срок SLA истёк (${deadline} мск), заявка остаётся активной.`],
    [sla === "near" ? 28 : 0, `Срок SLA близок (${deadline} мск), времени на реакцию мало.`],
    [highImpact ? 27 : 0, "В ITSM указана высокая оценка влияния, требуется ускорить реакцию."],
    [assignedToOperator ? 27 : 0, "Заявка передана координаторам и ожидает работы."],
    [needsHandoff ? 26 : 0, "У активной заявки ещё нет группы и исполнителя, требуется назначение."],
    [urgent ? 26 : 0, "В ITSM указана высокая срочность, требуется ускорить реакцию."],
  ] as const;
  const score = priorityWeight[incident.priority] + factors.reduce((total, [weight]) => total + weight, 0);
  if (score < 26) return null;

  const strongest = factors.filter(([weight]) => weight > 0).sort((a, b) => b[0] - a[0]);
  const reason = strongest.slice(0, 2).map(([, text]) => text).join(" ");
  return {
    score,
    reason: reason || (incident.priority === 4
      ? "Инцидент активен с критическим приоритетом ITSM и требует немедленной реакции."
      : "Инцидент активен с высоким приоритетом ITSM и требует оперативной проверки."),
  };
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : Number(a > b);
}
