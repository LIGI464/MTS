import { getSlaState, type Incident } from "@mts/contracts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatDuration(ms: number): string {
  const negative = ms < 0;
  const absolute = Math.abs(ms);
  let totalMinutes = Math.floor(absolute / MINUTE);
  if (negative && absolute > 0 && totalMinutes === 0) totalMinutes = 1;

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  const minutes = totalMinutes % 60;

  let body: string;
  if (days > 0) body = `${days} д ${hours} ч`;
  else if (hours > 0) body = `${hours} ч ${String(minutes).padStart(2, "0")} мин`;
  else body = `${minutes} мин`;

  return negative ? `−${body}` : body;
}

export function formatMoscow(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export type SlaTone = "alert" | "near" | "calm";

export type SlaView = {
  tone: SlaTone;
  status: string;
  duration: string | null;
  hint: string;
};

export function presentSla(incident: Incident, nowMs: number): SlaView {
  const sla = getSlaState(incident, nowMs);
  const hint = incident.dueAt ? `Срок: ${formatMoscow(incident.dueAt)}` : "Срок не задан";
  const alert = incident.priority === 4;

  if (incident.state === "Research") {
    const finished = incident.resolvedAt ? ` · ${formatMoscow(incident.resolvedAt)}` : "";
    return { tone: "calm", status: `Решён · исследование${finished}`, duration: null, hint };
  }

  if (sla === "done" && incident.state === "Closed") {
    const finished = incident.resolvedAt ? ` · ${formatMoscow(incident.resolvedAt)}` : "";
    return { tone: "calm", status: `Закрыт${finished}`, duration: null, hint };
  }

  if (sla === "done") {
    const finished = incident.resolvedAt ? ` · ${formatMoscow(incident.resolvedAt)}` : "";
    return { tone: "calm", status: `Решён${finished}`, duration: null, hint };
  }

  if (sla === "unknown" || incident.dueAt === null) {
    return { tone: alert ? "alert" : "calm", status: "Срок не задан", duration: null, hint };
  }

  const remaining = Date.parse(incident.dueAt) - nowMs;
  const duration = formatDuration(remaining);
  if (sla === "overdue") return { tone: "alert", status: "Просрочен", duration, hint };
  if (sla === "near") return { tone: "near", status: "Срок близко", duration, hint };
  return { tone: alert ? "alert" : "calm", status: "В сроке", duration, hint };
}

const moscowDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow", dateStyle: "short" });

export function registrationDay(iso: string): string {
  return moscowDay.format(new Date(iso));
}
