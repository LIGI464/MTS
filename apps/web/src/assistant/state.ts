import type { AssistantChatContext, AssistantChatMode, AssistantChatResponse } from "@mts/contracts";

type AssistantPhase = "collapsed" | "open";
type SessionKey = "dashboard" | `incident:${string}`;

export type IncidentContext = { id: string; title: string | null; version?: string };

type ChatMessage =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; response: AssistantChatResponse };

type PendingQuestion = { requestId: number; question: string; phase: "queued" | "sending" };

export type SessionState = {
  mode: AssistantChatMode;
  incidentId: string | null;
  incidentTitle: string | null;
  context: AssistantChatContext;
  draft: string;
  messages: ChatMessage[];
  pending: PendingQuestion | null;
  error: string | null;
};

export type AssistantState = {
  phase: AssistantPhase;
  activeKey: SessionKey;
  sessions: Partial<Record<SessionKey, SessionState>>;
};

export const CONTEXT_CHANGED = "Данные заявки обновились. Проверьте заявку и отправьте вопрос ещё раз.";

export function sessionKeyForIncident(id: string): SessionKey {
  return `incident:${id}`;
}

function createSession(incident: IncidentContext | null): SessionState {
  return {
    mode: incident ? "incident" : "dashboard",
    incidentId: incident?.id ?? null,
    incidentTitle: incident?.title ?? null,
    context: incident ? { incidentId: incident.id, incidentVersion: incident.version } : {},
    draft: "",
    messages: [],
    pending: null,
    error: null,
  };
}

function syncIncident(current: SessionState, incident: IncidentContext | null): SessionState {
  if (!incident) return current;
  const previousVersion = current.context.incidentVersion;
  if (previousVersion === incident.version) {
    return current.incidentTitle === incident.title ? current : { ...current, incidentTitle: incident.title };
  }
  const hadVersion = previousVersion !== undefined;
  return {
    ...current,
    incidentTitle: incident.title,
    context: { incidentId: incident.id, incidentVersion: incident.version },
    // A question queued before the first version arrives can be sent once that version is known.
    pending: hadVersion ? null : current.pending,
    error: hadVersion && current.pending ? CONTEXT_CHANGED : null,
  };
}

export function initialAssistantState(): AssistantState {
  return { phase: "collapsed", activeKey: "dashboard", sessions: {} };
}

function withSession(state: AssistantState, next: SessionState): AssistantState {
  return { ...state, sessions: { ...state.sessions, [state.activeKey]: next } };
}

type TargetEvent = { target: SessionKey; incident: IncidentContext | null };
type RequestEvent = { target: SessionKey; requestId: number };

type AssistantEvent =
  | ({ type: "open" } & TargetEvent)
  | ({ type: "sync" } & TargetEvent)
  | { type: "collapse" }
  | { type: "draft"; value: string }
  | ({ type: "queue"; question: string } & RequestEvent)
  | ({ type: "send" } & RequestEvent)
  | ({ type: "success"; response: AssistantChatResponse } & RequestEvent)
  | ({ type: "failure"; message: string } & RequestEvent)
  | { type: "cancel"; target: SessionKey };

export function reduceAssistant(state: AssistantState, event: AssistantEvent): AssistantState {
  const active = state.sessions[state.activeKey];
  if (event.type === "open" || event.type === "sync") {
    const { target, incident } = event;
    const phase = event.type === "open" ? "open" : state.phase;
    const previous = target !== state.activeKey && active?.pending
      ? withSession(state, { ...active, pending: null })
      : state;
    const existing = previous.sessions[target];
    const session = syncIncident(existing ?? createSession(incident), incident);
    if (phase === state.phase && target === state.activeKey && session === existing) return state;
    return { phase, activeKey: target, sessions: { ...previous.sessions, [target]: session } };
  }
  if (event.type === "collapse") return { ...state, phase: "collapsed" };
  if (!active || ("target" in event && event.target !== state.activeKey)) return state;
  if (event.type === "draft") return active.pending ? state : withSession(state, { ...active, draft: event.value });
  if (event.type === "queue") {
    if (active.pending || !event.question) return state;
    return withSession(state, {
      ...active,
      draft: event.question,
      error: null,
      pending: { requestId: event.requestId, question: event.question, phase: "queued" },
    });
  }
  if (event.type === "cancel") return withSession(state, { ...active, pending: null });

  const pending = active.pending;
  if (!pending || pending.requestId !== event.requestId) return state;
  if (event.type === "send") {
    if (pending.phase !== "queued") return state;
    return withSession(state, { ...active, pending: { ...pending, phase: "sending" } });
  }
  if (pending.phase !== "sending") return state;
  if (event.type === "failure") return withSession(state, { ...active, pending: null, error: event.message });

  const { response } = event;
  if (response.mode !== active.mode || (active.mode === "incident" && (
    response.context.incidentId !== active.incidentId || response.context.incidentVersion !== active.context.incidentVersion
  ))) {
    return withSession(state, { ...active, pending: null, error: CONTEXT_CHANGED });
  }
  return withSession(state, {
    ...active,
    draft: "",
    pending: null,
    context: response.context,
    messages: [
      ...active.messages,
      { id: `user:${pending.requestId}`, kind: "user", text: pending.question },
      { id: `assistant:${pending.requestId}`, kind: "assistant", response },
    ],
  });
}
