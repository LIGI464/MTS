import type { AssistantChatResponse, AssistantSimilarIncident } from "@mts/contracts";
import type { RefObject } from "react";
import type { SessionState } from "./state";
import { formatMoscow } from "../board/format";
import { Icon } from "../icons";
import styles from "./assistant.module.css";

const COMPLETED = new Set(["Resolved", "Closed"]);
const FALLBACK_MESSAGES = {
  not_configured: "Модель не настроена.",
  timeout: "Модель не ответила вовремя.",
  provider_error: "Сервис модели недоступен.",
  invalid_output: "Ответ модели не прошёл проверку.",
} as const;

export function AssistantPanel({
  state,
  inputRef,
  contextError,
  onDraft,
  onSubmit,
  onCollapse,
  onCancel,
  onRetryContext,
}: {
  state: SessionState;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  contextError: string | null;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onCollapse: () => void;
  onCancel: () => void;
  onRetryContext: () => void;
}) {
  const conversationId = state.incidentId ?? "dashboard";
  const { pending, error } = state;
  const sending = pending?.phase === "sending";
  const waitingError = pending?.phase === "queued" ? contextError : null;
  const empty = !state.messages.length && !pending && !error;

  return (
    <aside
      className={styles.panel}
      id="mts-assistant-panel"
      aria-label="Помощник МТС"
      data-mode={state.mode}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title}>Помощник МТС</h2>
          {state.incidentId ? (
            <p className={styles.context} data-numeric="tabular">
              <span>{state.incidentId}</span>
              {state.incidentTitle ? <span>{state.incidentTitle}</span> : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.collapse}
          onClick={onCollapse}
          aria-expanded="true"
          aria-controls="mts-assistant-panel"
        >
          Свернуть чат
        </button>
      </header>

      <div
        className={styles.messages}
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={sending}
      >
        {empty ? (
          <p className={styles.pending}>{state.mode === "incident"
            ? "Задайте вопрос по заявке или по сводке пульта."
            : "Укажите ID инцидента или опишите симптомы."}</p>
        ) : null}
        {state.messages.map((message) => {
          if (message.kind === "user") {
            return (
              <article key={message.id} className={styles.userMessage}>
                <p className={styles.summary}>{message.text}</p>
              </article>
            );
          }
          return <AssistantAnswer key={message.id} response={message.response} />;
        })}
        {sending ? <article className={styles.userMessage}><p className={styles.summary}>{pending.question}</p></article> : null}
        {pending ? (
          <div className={styles.pendingActions}>
            <p className={styles.pending} role={waitingError ? "alert" : "status"}>
              {waitingError ?? (sending ? "Помощник готовит ответ…" : "Ждём данные заявки…")}
            </p>
            {waitingError ? <button type="button" onClick={onRetryContext}>Повторить загрузку</button> : null}
            <button type="button" onClick={onCancel}>Отменить</button>
          </div>
        ) : null}
        {error ? (
          <article className={styles.errorMessage} role="alert">
            <p className={styles.summary}>{error}</p>
            <button type="button" disabled={!state.draft.trim()} onClick={onSubmit}>Повторить</button>
          </article>
        ) : null}
      </div>

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="sr-only" htmlFor={`assistant-input-${conversationId}`}>Вопрос помощнику</label>
        <textarea
          ref={inputRef}
          id={`assistant-input-${conversationId}`}
          className={styles.input}
          rows={2}
          value={sending ? "" : state.draft}
          disabled={Boolean(pending)}
          placeholder="Введите сообщение"
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button type="submit" className={styles.send} disabled={Boolean(pending) || state.draft.trim().length === 0}>
          Отправить сообщение
        </button>
      </form>
    </aside>
  );
}

function AssistantAnswer({ response }: { response: AssistantChatResponse }) {
  const count = response.matches.length;
  const { reason } = response;
  const fallback = reason && reason !== "rules_mode" ? FALLBACK_MESSAGES[reason] : null;
  return (
    <article className={styles.assistantMessage}>
      <p className={styles.summary}>{response.summary}</p>
      {response.nextSteps.length > 0 ? (
        <ul className={styles.steps}>
          {response.nextSteps.map((step) => <li key={step}>{step}</li>)}
        </ul>
      ) : null}
      {response.status === "no_matches" ? (
        <p className={styles.meta}>Подходящих завершённых инцидентов не найдено.</p>
      ) : null}
      {response.status === "answered" && count > 0 ? (
        <p className={styles.meta} data-numeric="tabular">Найдено совпадений: {count}</p>
      ) : null}
      {response.matches.map((match) => <MatchCard key={`${match.id}:${match.version}`} match={match} />)}
      <p className={styles.source}>
        {response.source === "llm" ? "codex.sale" : "Локальные правила"}
        {fallback ? ` · ${fallback}` : null}
      </p>
    </article>
  );
}

function MatchCard({ match }: { match: AssistantSimilarIncident }) {
  const completed = COMPLETED.has(match.state);
  return (
    <section className={styles.matchCard} aria-label={`Аналог ${match.id}`}>
      <div className={styles.matchHeader}>
        <span className={styles.matchStatus}>{completed ? "Завершён" : match.state}</span>
        {match.resolvedAt ? (
          <time className={styles.matchDate} dateTime={match.resolvedAt}>{formatMoscow(match.resolvedAt)}</time>
        ) : null}
      </div>
      <h3 className={styles.matchTitle}>{match.title}</h3>
      {match.symptom ? (
        <p className={styles.matchRow}><Icon name="search" size={14} /> <span>Симптом: {match.symptom}</span></p>
      ) : null}
      {match.solution ? (
        <p className={styles.matchRow}><Icon name="clipboard-data" size={14} /> <span>Решение: {match.solution}</span></p>
      ) : null}
      <a className={styles.matchLink} href={match.href} target={match.href.startsWith("http") ? "_blank" : undefined}
        rel={match.href.startsWith("http") ? "noopener noreferrer" : undefined}>
        В ITSM <span data-numeric="tabular">{match.id}</span> <Icon name="box-arrow-up-right" size={14} />
      </a>
    </section>
  );
}
