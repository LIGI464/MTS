import type { AssistantChatRequest, AssistantChatResponse, Incident } from "@mts/contracts";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Icon } from "../icons";
import { AssistantPanel } from "./assistant-panel";
import styles from "./assistant.module.css";
import {
  createSession,
  initialAssistantState,
  reduceAssistant,
  sessionKeyForIncident,
  shouldBootstrapIncidentChat,
  type SessionState,
} from "./state";

export type AssistantClient = (
  payload: AssistantChatRequest,
  token?: string,
) => Promise<AssistantChatResponse>;

export function AssistantHost({
  detailsOpen,
  incident,
  operatorToken,
  requestChat,
  onOpenChange,
}: {
  detailsOpen: boolean;
  incident: Incident | undefined;
  operatorToken: string | undefined;
  requestChat: AssistantClient;
  onOpenChange?: (open: boolean) => void;
}) {
  const [state, dispatch] = useReducer(reduceAssistant, undefined, initialAssistantState);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bootstrapRef = useRef<Set<string>>(new Set());

  const session = useMemo((): SessionState | null => {
    const existing = state.sessions[state.activeKey];
    if (existing) return existing;
    if (state.phase !== "open") return null;
    if (state.activeKey === "dashboard") return createSession("dashboard", null);
    if (!incident) return createSession("incident", null);
    return createSession("incident", { id: incident.id, title: incident.title, version: incident.version });
  }, [state, incident]);

  const open = state.phase === "open";
  const shiftDetails = open && detailsOpen && state.activeKey !== "dashboard";

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

  const send = useCallback(async (question: string, active: SessionState) => {
    const requestId = active.requestId + 1;
    dispatch({ type: "start", requestId, question: question.trim() });
    const payload: AssistantChatRequest = {
      mode: active.mode,
      question: question.trim(),
      context: active.context,
    };
    try {
      const response = await requestChat(payload, operatorToken);
      dispatch({ type: "success", requestId, response });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Не удалось получить ответ помощника";
      dispatch({ type: "failure", requestId, message });
    }
  }, [operatorToken, requestChat]);

  const runBootstrap = useCallback((key: string, active: SessionState) => {
    if (active.mode !== "incident" || !shouldBootstrapIncidentChat(active.messages) || bootstrapRef.current.has(key)) return;
    bootstrapRef.current.add(key);
    void send("", active);
  }, [send]);

  function openAssistant(targetIncident: Incident | null) {
    const target = targetIncident ? sessionKeyForIncident(targetIncident.id) : "dashboard";
    const incidentInfo = targetIncident
      ? { id: targetIncident.id, title: targetIncident.title, version: targetIncident.version }
      : null;
    launcherRef.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : launcherRef.current;
    dispatch({ type: "open", target, incident: incidentInfo });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  function collapseAssistant() {
    dispatch({ type: "collapse" });
    requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (!open) return;
    if (!detailsOpen && state.activeKey !== "dashboard") {
      dispatch({ type: "switch", target: "dashboard", incident: null });
    }
  }, [detailsOpen, open, state.activeKey]);

  useEffect(() => {
    if (!open || !incident) return;
    const key = sessionKeyForIncident(incident.id);
    if (state.activeKey === key) return;
    dispatch({ type: "switch", target: key, incident: { id: incident.id, title: incident.title, version: incident.version } });
  }, [incident?.id, incident?.version, incident?.title, open, state.activeKey, incident]);

  useEffect(() => {
    if (!open || !session) return;
    runBootstrap(state.activeKey, session);
  }, [open, session, state.activeKey, runBootstrap]);

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
  }, [open]);

  function submitCurrent() {
    if (!session || session.pending) return;
    const text = session.draft.trim();
    if (!text && session.mode === "dashboard") return;
    void send(text, session);
  }

  function retryLast() {
    if (!session) return;
    dispatch({ type: "clear_error" });
    const lastError = session.messages.findLast((entry) => entry.kind === "error");
    if (lastError?.kind !== "error") return;
    void send(lastError.retry.question, { ...session, context: lastError.retry.context, mode: lastError.retry.mode });
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
        onClick={() => openAssistant(detailsOpen && incident ? incident : null)}
      >
        <span className={styles.launcherMark} aria-hidden="true"><Icon name="clipboard-data" size={22} /></span>
        <span className={styles.launcherText}>
          <strong>Помощник МТС</strong>
          <span>Спросить</span>
        </span>
        <Icon name="arrow-left" size={18} />
      </button>

      <div className={styles.shell} data-open={open} aria-hidden={!open}>
        {session ? (
          <AssistantPanel
            state={session}
            inputRef={inputRef}
            onDraft={(value) => dispatch({ type: "draft", value })}
            onSubmit={submitCurrent}
            onCollapse={collapseAssistant}
            onRetry={retryLast}
          />
        ) : null}
      </div>
    </>
  );
}
