import type { AssistantChatHistoryEntry, AssistantChatRequest, AssistantChatResponse } from "@mts/contracts";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { Icon } from "../icons";
import { AssistantPanel } from "./assistant-panel";
import styles from "./assistant.module.css";
import { initialAssistantState, reduceAssistant, sessionKeyForIncident, type IncidentContext, type SessionState } from "./state";

export type AssistantClient = (
  payload: AssistantChatRequest,
  token?: string,
  signal?: AbortSignal,
) => Promise<AssistantChatResponse>;

function chatHistory(messages: SessionState["messages"]): AssistantChatHistoryEntry[] {
  return messages.slice(-16).map((message) => message.kind === "user"
    ? { role: "user", text: message.text }
    : { role: "assistant", text: message.response.summary });
}

export function AssistantHost({
  incident,
  contextReady,
  contextError,
  retryContext,
  operatorToken,
  requestChat,
  onOpenChange,
}: {
  incident: IncidentContext | null;
  contextReady: boolean;
  contextError: string | null;
  retryContext: () => void;
  operatorToken: string | undefined;
  requestChat: AssistantClient;
  onOpenChange?: (open: boolean) => void;
}) {
  const [state, dispatch] = useReducer(reduceAssistant, undefined, initialAssistantState);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sequence = useRef(0);
  const transport = useRef<{ requestId: number; controller: AbortController } | null>(null);
  const incidentId = incident?.id;
  const title = incident?.title ?? null;
  const version = incident?.version;
  const target = incidentId ? sessionKeyForIncident(incidentId) : "dashboard";
  const session = state.sessions[target];
  const open = state.phase === "open";
  const shiftDetails = open && Boolean(incidentId);
  const scopeReady = state.activeKey === target && (!incidentId || session?.context.incidentVersion === version);

  useLayoutEffect(() => {
    dispatch({ type: "sync", target, incident: incidentId ? { id: incidentId, title, version } : null });
  }, [target, incidentId, title, version]);

  useEffect(() => {
    document.body.dataset.assistantOpen = open ? "true" : "false";
    document.body.dataset.assistantShift = shiftDetails ? "true" : "false";
    return () => {
      delete document.body.dataset.assistantOpen;
      delete document.body.dataset.assistantShift;
    };
  }, [open, shiftDetails]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    const pending = session?.pending;
    if (transport.current && (!scopeReady || transport.current.requestId !== pending?.requestId)) {
      transport.current.controller.abort();
      transport.current = null;
    }
    if (!scopeReady || !contextReady || !session || pending?.phase !== "queued" || transport.current) return;

    const { requestId, question } = pending;
    const controller = new AbortController();
    transport.current = { requestId, controller };
    dispatch({ type: "send", target, requestId });
    const payload: AssistantChatRequest = {
      mode: session.mode, question, context: session.context, history: chatHistory(session.messages),
    };
    void requestChat(payload, operatorToken, controller.signal).then(
      (response) => {
        if (!controller.signal.aborted) dispatch({ type: "success", target, requestId, response });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Не удалось получить ответ помощника.";
        dispatch({ type: "failure", target, requestId, message });
      },
    );
  }, [session, scopeReady, contextReady, target, operatorToken, requestChat]);

  useEffect(() => () => transport.current?.controller.abort(), []);

  function openAssistant() {
    dispatch({ type: "open", target, incident });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  const collapseAssistant = useCallback(() => {
    dispatch({ type: "collapse" });
    requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      collapseAssistant();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, collapseAssistant]);

  function submitCurrent() {
    const question = session?.draft.trim();
    if (!scopeReady || !question || session?.pending) return;
    dispatch({ type: "queue", target, requestId: ++sequence.current, question });
  }

  function cancel() {
    transport.current?.controller.abort();
    dispatch({ type: "cancel", target });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        hidden={open}
        aria-hidden={open}
        tabIndex={open ? -1 : undefined}
        aria-expanded={open}
        aria-controls="mts-assistant-panel"
        onClick={openAssistant}
      >
        <span className={styles.launcherMark} aria-hidden="true"><Icon name="clipboard-data" size={22} /></span>
        <span className={styles.launcherText}>
          <strong>Помощник МТС</strong>
          <span>Спросить</span>
        </span>
        <Icon name="arrow-left" size={18} />
      </button>

      <div className={styles.shell} data-open={open} aria-hidden={!open} inert={!open}>
        {session ? (
          <AssistantPanel
            state={session}
            inputRef={inputRef}
            contextError={contextError}
            onDraft={(value) => dispatch({ type: "draft", value })}
            onSubmit={submitCurrent}
            onCollapse={collapseAssistant}
            onCancel={cancel}
            onRetryContext={retryContext}
          />
        ) : null}
      </div>
    </>
  );
}
