import {
  COORDINATOR_TEAM,
  isActiveState,
  type AnalysisResult,
  type getSlaState,
  type Incident,
} from "@mts/contracts";

export const SUMMARY_LIMIT = 280;

const sentences = new Intl.Segmenter("ru", { granularity: "sentence" });
const completedStates = new Set<Incident["state"]>(["Resolved", "Closed", "Research"]);
const coordinator = normalize(COORDINATOR_TEAM);

type Candidate = NonNullable<AnalysisResult["recommendedTeam"]>;
type Match = { name: string; exact: boolean; count: number; lastResolvedAt: number };

export function cleanText(value: string): string {
  return value.replace(/\p{Cc}/gu, " ").replace(/\s+/gu, " ").trim();
}

export function limitText(value: string, limit: number): string {
  return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "").trimEnd();
}

export function summarize(incident: Incident, description: string): string {
  let summary = cleanText(incident.summary ?? "");
  if (!summary) {
    for (const { segment } of sentences.segment(description)) {
      const sentence = segment.trim();
      if (/[.!?…][»”’"')\]]*$/u.test(sentence)) {
        summary = sentence;
        break;
      }
    }
  }
  if (!summary) {
    summary = [cleanText(incident.title), cleanText(incident.product ?? "")].filter(Boolean).join(" · ");
  }
  return limitText(summary || cleanText(incident.id) || "Инцидент", SUMMARY_LIMIT);
}

export function selectCandidates(incident: Incident, history: readonly Incident[]): Candidate[] {
  const product = normalize(incident.product);
  const service = normalize(incident.service);
  if (!product) return [];

  const matches = new Map<string, Match>();
  for (const record of history) {
    if (record.id === incident.id || !completedStates.has(record.state)) continue;
    if (normalize(record.product) !== product) continue;
    const name = record.team?.trim() ?? "";
    const teamKey = normalize(name);
    if (!teamKey || teamKey === coordinator) continue;

    const exact = service !== "" && normalize(record.service) === service;
    const lastResolvedAt = record.resolvedAt === null ? -Infinity : Date.parse(record.resolvedAt);
    const previous = matches.get(teamKey);
    if (!previous || (exact && !previous.exact)) {
      matches.set(teamKey, { name, exact, count: 1, lastResolvedAt });
      continue;
    }
    if (exact !== previous.exact) continue;
    previous.count++;
    if (
      lastResolvedAt > previous.lastResolvedAt ||
      (lastResolvedAt === previous.lastResolvedAt && compareNames(name, previous.name) < 0)
    ) {
      previous.name = name;
      previous.lastResolvedAt = lastResolvedAt;
    }
  }

  return [...matches.values()]
    .sort((left, right) =>
      Number(right.exact) - Number(left.exact) ||
      right.count - left.count ||
      right.lastResolvedAt - left.lastResolvedAt ||
      compareNames(left.name, right.name),
    )
    .slice(0, 3)
    .map(({ name, exact, count }) => ({
      name,
      reason: exact
        ? `Решённые инциденты с таким же продуктом и сервисом: ${count}.`
        : `Решённые инциденты с таким же продуктом: ${count}.`,
    }));
}

export function assessRisk(
  incident: Incident,
  sla: ReturnType<typeof getSlaState>,
): AnalysisResult["risk"] {
  if (incident.priority === 4) {
    return { level: "not_applicable", factors: ["Критический приоритет уже установлен."] };
  }
  if (!isActiveState(incident.state)) {
    return { level: "not_applicable", factors: ["Инцидент сейчас не активен."] };
  }

  let score = 0;
  const factors: string[] = [];
  if (incident.priority === 3) {
    score += 2;
    factors.push("Высокий приоритет");
  }
  if ((incident.impact ?? 0) >= 3) {
    score += 2;
    factors.push("Высокое влияние");
  }
  if ((incident.urgency ?? 0) >= 3) {
    score++;
    factors.push("Высокая срочность");
  }
  if (sla === "near" || sla === "overdue") {
    score++;
    factors.push(sla === "near" ? "Срок SLA близок" : "Срок SLA просрочен");
  }

  const noAssignee = !incident.assignee?.trim();
  const assignedToCoordinator = normalize(incident.team) === coordinator;
  if (noAssignee || assignedToCoordinator) {
    score++;
    if (noAssignee) factors.push("Исполнитель не назначен");
    if (assignedToCoordinator) factors.push("Инцидент назначен координаторам");
  }

  if (factors.length === 0) factors.push("По полям выгрузки повышающих факторов не видно");
  const level = score >= 5 ? "high" : score >= 3 ? "medium" : "low";
  return { level, factors };
}

function normalize(value: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, "ru") || (left < right ? -1 : Number(left > right));
}
