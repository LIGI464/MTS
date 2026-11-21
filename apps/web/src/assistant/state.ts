import type { AssistantChatContext, AssistantChatMode, AssistantChatResponse } from "@mts/contracts";

export type AssistantPhase = "collapsed" | "open";
export type SessionKey = "dashboard" | `incident:${string}`;

export type ChatMessage =
  | { id: string; kind: "welcome" }
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; response: AssistantChatResponse }
  | {
      id: string;
      kind: "error";
      message: string;
      retry: { question: string; context: AssistantChatContext; mode: AssistantChatMode };
    };

export type SessionState = {
  mode: AssistantChatMode;
  incidentId: string | null;
  incidentTitle: string | null;
  context: AssistantChatContext;
  draft: string;
  messages: ChatMessage[];
  pending: boolean;
  requestId: number;
};

export type AssistantState = {
  phase: AssistantPhase;
  activeKey: SessionKey;
  sessions: Partial<Record<SessionKey, SessionState>>;
};

export function sessionKeyForIncident(id: string): SessionKey {
  return `incident:${id}`;
}

export function createSession(
  mode: AssistantChatMode,
  incident: { id: string; title: string; version: string } | null,
): SessionState {
  return {
    mode,
    incidentId: incident?.id ?? null,
    incidentTitle: incident?.title ?? null,
    context: incident ? { incidentId: incident.id, incidentVersion: incident.version } : {},
    draft: "",
    messages: mode === "dashboard" ? [{ id: "welcome", kind: "welcome" }] : [],
    pending: false,
    requestId: 0,
  };
}

export function initialAssistantState(): AssistantState {
  return { phase: "collapsed", activeKey: "dashboard", sessions: {} };
}

function withSession(state: AssistantState, next: SessionState): AssistantState {
  return { ...state, sessions: { ...state.sessions, [state.activeKey]: next } };
}

function activeSession(state: AssistantState): SessionState {
  const found = state.sessions[state.activeKey];
  if (found) return found;
  return createSession(state.activeKey === "dashboard" ? "dashboard" : "incident", null);
}

export type AssistantEvent =
  | { type: "open"; target: SessionKey; incident: { id: string; title: string; version: string } | null }
  | { type: "collapse" }
  | { type: "switch"; target: SessionKey; incident: { id: string; title: string; version: string } | null }
  | { type: "draft"; value: string }
  | { type: "start"; requestId: number; question: string }
  | { type: "success"; requestId: number; response: AssistantChatResponse }
  | { type: "failure"; requestId: number; message: string }
  | { type: "clear_error" };

export function reduceAssistant(state: AssistantState, event: AssistantEvent): AssistantState {
  if (event.type === "open") {
    const exists = state.sessions[event.target];
    const sessions = exists
      ? state.sessions
      : { ...state.sessions, [event.target]: createSession(event.target === "dashboard" ? "dashboard" : "incident", event.incident) };
    return { phase: "open", activeKey: event.target, sessions };
  }
  if (event.type === "collapse") return { ...state, phase: "collapsed" };
  if (event.type === "switch") {
    const exists = state.sessions[event.target];
    const sessions = exists
      ? state.sessions
      : { ...state.sessions, [event.target]: createSession(event.target === "dashboard" ? "dashboard" : "incident", event.incident) };
    return { ...state, activeKey: event.target, sessions };
  }

  const current = activeSession(state);
  if (event.type === "draft") return withSession(state, { ...current, draft: event.value });
  if (event.type === "start") {
    if (event.requestId <= current.requestId) return state;
    const messages = event.question.trim()
      ? [...current.messages, { id: `user:${event.requestId}`, kind: "user" as const, text: event.question }]
      : current.messages;
    return withSession(state, {
      ...current,
      requestId: event.requestId,
      pending: true,
      draft: "",
      messages,
    });
  }
  if (event.type === "success") {
    if (event.requestId !== current.requestId) return state;
    return withSession(state, {
      ...current,
      pending: false,
      context: event.response.context,
      messages: [...current.messages, { id: `assistant:${event.requestId}`, kind: "assistant", response: event.response }],
    });
  }
  if (event.type === "failure") {
    if (event.requestId !== current.requestId) return state;
    const lastUser = [...current.messages].reverse().find((entry) => entry.kind === "user");
    return withSession(state, {
      ...current,
      pending: false,
      messages: [...current.messages, {
        id: `error:${event.requestId}`,
        kind: "error",
        message: event.message,
        retry: {
          question: lastUser?.kind === "user" ? lastUser.text : "",
          context: current.context,
          mode: current.mode,
        },
      }],
    });
  }
  if (event.type === "clear_error") {
    return withSession(state, { ...current, messages: current.messages.filter((entry) => entry.kind !== "error") });
  }
  return state;
}

export function shouldBootstrapIncidentChat(messages: ChatMessage[]): boolean {
  return messages.length === 0;
}