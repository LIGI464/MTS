import type { AnalysisResult, Incident } from "@mts/contracts";

export type AnalysisPhase = "idle" | "pending" | "ready" | "error";

export type AnalysisView = {
  phase: AnalysisPhase;
  incidentId: string;
  incidentVersion: string;
  result: AnalysisResult | null;
  error: string | null;
};

export function analysisView(incident: Pick<Incident, "id" | "version">): AnalysisView {
  return {
    phase: "idle",
    incidentId: incident.id,
    incidentVersion: incident.version,
    result: null,
    error: null,
  };
}

export type AnalysisEvent =
  | { type: "reset"; incident: Pick<Incident, "id" | "version"> }
  | { type: "start" }
  | { type: "success"; result: AnalysisResult }
  | { type: "failure"; message: string };

export function reduceAnalysis(state: AnalysisView, event: AnalysisEvent): AnalysisView {
  if (event.type === "reset") {
    if (state.incidentId === event.incident.id && state.incidentVersion === event.incident.version) return state;
    return analysisView(event.incident);
  }
  if (event.type === "start") {
    if (state.phase === "pending") return state;
    return { ...state, phase: "pending", error: null };
  }
  if (event.type === "success") {
    if (state.phase !== "pending") return state;
    if (event.result.incidentId !== state.incidentId || event.result.incidentVersion !== state.incidentVersion) {
      return { ...state, phase: "idle", result: null };
    }
    return { ...state, phase: "ready", result: event.result, error: null };
  }
  return state.phase === "pending" ? { ...state, phase: "error", error: event.message, result: null } : state;
}

export function sourceLabel(source: AnalysisResult["source"]): string {
  return source === "llm" ? "codex.sale" : "Локальные правила";
}

export function reasonLabel(reason: AnalysisResult["reason"]): string {
  switch (reason) {
    case "rules_mode":
      return "Режим правил";
    case "not_configured":
      return "Анализ не настроен";
    case "timeout":
      return "Превышено время ожидания";
    case "provider_error":
      return "Ошибка поставщика";
    case "invalid_output":
      return "Некорректный ответ";
    default:
      return "";
  }
}

export function riskLabel(level: AnalysisResult["risk"]["level"], reason: AnalysisResult["reason"]): string {
  if (level === "not_applicable") {
    const because = reasonLabel(reason);
    return because.length > 0 ? `Не применяется. ${because}` : "Не применяется";
  }
  if (level === "low") return "Низкий";
  if (level === "medium") return "Средний";
  return "Высокий";
}

export function explainFactor(factor: string): string {
  if (/sla|срок|deadline/i.test(factor)) {
    return `${factor}. Это значит, что до дедлайна осталось мало времени или срок уже прошёл.`;
  }
  return factor;
}
