import type { AssistantSimilarIncident } from "@mts/contracts";
import type { RefObject } from "react";
import type { SessionState } from "./state";
import { formatMoscow } from "../board/format";
import { Icon } from "../icons";
import styles from "./assistant.module.css";

const COMPLETED = new Set(["Resolved", "Closed"]);

export function AssistantPanel({
  state,
  inputRef,
  onDraft,
  onSubmit,
  onCollapse,
  onRetry,
}: {
  state: SessionState;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onCollapse: () => void;
  onRetry: () => void;
}) {
  const conversationId = state.incidentId ?? "dashboard";

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
        aria-busy={state.pending}
      >
        {state.messages.map((message) => {
          if (message.kind === "welcome") {
            return (
              <article key={message.id} className={styles.assistantMessage}>
                <p>Укажите ID инцидента или опишите симптомы.</p>
              </article>
            );
          }
          if (message.kind === "user") {
            return (
              <article key={message.id} className={styles.userMessage}>
                <p>{message.text}</p>
              </article>
            );
          }
          if (message.kind === "error") {
            return (
              <article key={message.id} className={styles.errorMessage} role="alert">
                <p>{message.message}</p>
                <button type="button" onClick={onRetry}>Повторить</button>
              </article>
            );
          }
          return <AssistantAnswer key={message.id} response={message.response} />;
        })}
        {state.pending ? <p className={styles.pending} role="status">Помощник готовит ответ…</p> : null}
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
          value={state.draft}
          disabled={state.pending}
          placeholder={state.incidentId ? "Уточните вопрос по заявке" : "Номер инцидента или симптомы"}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        <button type="submit" className={styles.send} disabled={state.pending || state.draft.trim().length === 0}>
          Отправить сообщение
        </button>
      </form>
    </aside>
  );
}

function AssistantAnswer({ response }: { response: import("@mts/contracts").AssistantChatResponse }) {
  const count = response.matches.length;
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
      <p className={styles.source}>{response.source === "llm" ? "codex.sale" : "Локальные правила"}</p>
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
