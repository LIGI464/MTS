import { COORDINATOR_TEAM, STATE_LABELS } from "./constants.js";
import { groupIncidentIds } from "./groups.js";
import type { Incident, Notice, Snapshot } from "./schemas.js";

const CRITICAL_ID = "INC000000000001";
const TIMER_ID = "INC000000000002";
const RESEARCH_ID = "INC000000000003";

export function makeMockTimeline(nowMs: number): {
  initial: Snapshot;
  frames: Record<"critical" | "assign" | "deadline" | "resolve", Snapshot>;
} {
  const nowIso = new Date(nowMs).toISOString();
  const critical = card({
    id: CRITICAL_ID,
    title: "Массовый отказ авторизации",
    product: "Мобильная связь",
    service: "Авторизация",
    team: "Эксплуатация сети",
    assignee: "Иванов И.И.",
    state: "Assigned",
    stateLabel: STATE_LABELS.Assigned,
    priority: 3,
    urgency: 3,
    impact: 3,
    createdAt: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
    dueAt: new Date(nowMs + 2 * 60 * 60 * 1000).toISOString(),
    resolvedAt: null,
    summary: "Пользователи не могут войти в сервис",
  });
  const timer = card({
    id: TIMER_ID,
    title: "Задержка витрины",
    product: "Домашний интернет",
    service: "Витрина",
    team: "Сопровождение витрины",
    assignee: null,
    state: "WorkInProgress",
    stateLabel: STATE_LABELS.WorkInProgress,
    priority: 3,
    urgency: 2,
    impact: 2,
    createdAt: new Date(nowMs - 25 * 60 * 1000).toISOString(),
    dueAt: new Date(nowMs + 3 * 60 * 60 * 1000).toISOString(),
    resolvedAt: null,
    summary: "Страница услуги открывается с задержкой",
  });
  const research = card({
    id: RESEARCH_ID,
    title: "Исследование обрыва канала",
    product: "Фиксированная связь",
    service: "Канал",
    team: "Сетевой анализ",
    assignee: "Петров П.П.",
    state: "Research",
    stateLabel: STATE_LABELS.Research,
    priority: 2,
    urgency: null,
    impact: 2,
    createdAt: new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString(),
    dueAt: null,
    resolvedAt: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
    summary: "Причина обрыва уточняется",
  });

  const promoted = card({ ...critical, priority: 4 });
  const assigned = card({ ...promoted, team: COORDINATOR_TEAM });
  const deadlineTimer = card({ ...timer, dueAt: new Date(nowMs + 90 * 1000).toISOString() });
  const resolved = card({
    ...assigned,
    state: "Resolved",
    stateLabel: STATE_LABELS.Resolved,
    resolvedAt: nowIso,
  });

  const criticalNotice = notice(1, "critical.new", promoted, promoted.title, nowIso);
  const assignNotice = notice(2, "coordinator.assigned", assigned, assigned.title, nowIso);
  const resolveNotice = notice(3, "critical.resolved", resolved, "Критический инцидент решён", nowIso);

  return {
    initial: snapshot(1, [critical, timer, research], [], nowIso),
    frames: {
      critical: snapshot(2, [promoted, timer, research], [criticalNotice], nowIso),
      assign: snapshot(3, [assigned, timer, research], [criticalNotice, assignNotice], nowIso),
      deadline: snapshot(4, [assigned, deadlineTimer, research], [criticalNotice, assignNotice], nowIso),
      resolve: snapshot(5, [resolved, deadlineTimer, research], [criticalNotice, assignNotice, resolveNotice], nowIso),
    },
  };
}

function snapshot(revision: number, incidents: Incident[], notices: Notice[], nowIso: string): Snapshot {
  return {
    apiVersion: 1,
    revision,
    serverNow: nowIso,
    source: { status: "ok", lastGoodAt: nowIso },
    capabilities: { demoReset: true, liveAnalysis: false },
    incidents,
    groups: groupIncidentIds(incidents),
    notices,
  };
}

function notice(
  seq: number,
  kind: Notice["kind"],
  incident: Incident,
  title: string | null,
  at: string,
): Notice {
  return {
    seq,
    kind,
    incidentId: incident.id,
    title,
    at,
  };
}

function card(fields: Omit<Incident, "version" | "itsmUrl"> & { itsmUrl?: string | null }): Incident {
  const incident: Incident = {
    ...fields,
    itsmUrl: fields.itsmUrl ?? null,
    version: "",
  };
  const { version: _version, ...hashed } = incident;
  incident.version = opaqueHash(hashed);
  return incident;
}

function opaqueHash(value: unknown): string {
  const text = JSON.stringify(value);
  const hash = (seed: number) => {
    let state = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      state ^= text.charCodeAt(index);
      state = Math.imul(state, 0x01000193);
    }
    return (state >>> 0).toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x811c9dc5 ^ 0x9e3779b9)}`;
}
