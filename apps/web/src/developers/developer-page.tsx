import * as Dialog from "@radix-ui/react-dialog";
import { isActiveState } from "@mts/contracts";
import { useRef, useState } from "react";
import { itsmHref } from "../board/itsm";
import {
  DeveloperRequestError,
  type DeveloperTransport,
} from "./client";
import {
  ACTION_LABELS,
  ACTION_ORDER,
  applyFailure,
  applySuccess,
  beginReset,
  chooseDeadline,
  createSession,
  editSolution,
  finishReset,
  messages,
  prepareSubmit,
  selectIncident,
  sourceLabel,
  type DeveloperAction,
  type Session,
} from "./model";
import styles from "./developer.module.css";

export type DeveloperIncident = {
  id: string;
  version: string;
  title: string;
  state: Parameters<typeof isActiveState>[0];
  stateLabel: string;
  itsmUrl: string | null;
};

export type DeveloperStand = {
  mode: "live" | "mock" | "read";
  sourceStatus: "ok" | "stale" | "unavailable";
  incidents: DeveloperIncident[];
};

export function DeveloperPage({
  stand,
  transport,
}: {
  stand: DeveloperStand;
  transport: DeveloperTransport;
}) {
  const [session, setSession] = useState<Session>(createSession);
  const [token, setToken] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const writing = useRef(false);
  const writable = stand.mode === "live";
  const busy = session.phase === "pending";
  const selected = stand.incidents.find((incident) => incident.id === session.selectedId) ?? null;
  const versionPending = Boolean(selected && !selected.version && !session.versionOverride[selected.id]);
  const options = stand.incidents.filter((incident) => isActiveState(incident.state) || incident.id === session.selectedId);

  async function run(action: DeveloperAction) {
    if (writing.current) return;
    const now = new Date();
    const prepared = prepareSubmit(session, {
      action,
      requestId: crypto.randomUUID(),
      nowMs: now.getTime(),
      at: now.toISOString(),
      incidents: stand.incidents,
    });
    setSession(prepared.state);
    if (!prepared.intent) return;
    if (token.trim().length === 0) {
      setSession(applyFailure(prepared.state, "token", new Date().toISOString()));
      return;
    }
    writing.current = true;
    try {
      const receipt = await transport.send(prepared.intent, token.trim());
      setSession((current) => applySuccess(current.phase === "pending" ? current : prepared.state, receipt, new Date().toISOString()));
    } catch (caught) {
      const kind = caught instanceof DeveloperRequestError ? caught.kind : "network";
      const fresh = kind === "conflict" && prepared.intent?.id ? await transport.reload(prepared.intent.id) : null;
      setSession((current) =>
        applyFailure(current.phase === "pending" ? current : prepared.state, kind, new Date().toISOString(), fresh?.version ?? null),
      );
    } finally {
      writing.current = false;
    }
  }

  async function confirmAndReset() {
    if (writing.current) return;
    const started = beginReset(session);
    if (started === session) return;
    setSession(started);
    setConfirmReset(false);
    if (token.trim().length === 0) {
      setSession(finishReset(started, new Date().toISOString(), false, "token"));
      return;
    }
    writing.current = true;
    try {
      await transport.reset(token.trim());
      setSession((current) => finishReset(current.phase === "pending" ? current : started, new Date().toISOString(), true));
    } catch (caught) {
      const kind = caught instanceof DeveloperRequestError ? caught.kind : "network";
      setSession((current) => finishReset(current.phase === "pending" ? current : started, new Date().toISOString(), false, kind));
    } finally {
      writing.current = false;
    }
  }

  return (
    <section className={styles.page} aria-label="Разработчикам">
      <header>
        <h1 className={styles.heading}>Разработчикам</h1>
        <p className={styles.meta}>
          <span>{writable ? messages.standLive : stand.mode === "mock" ? "Автономная демонстрация" : "Режим чтения"}</span>
          <span>{sourceLabel(stand.sourceStatus)}</span>
        </p>
      </header>
      {stand.mode === "mock" ? <p className={styles.notice} role="status">{messages.mock}</p> : null}
      {stand.mode === "read" ? <p className={styles.notice} role="status">{messages.read}</p> : null}
      <div className={styles.layout}>
        <div className={styles.scenarios} data-surface="ink">
          {ACTION_ORDER.map((action) => (
            <button
              key={action}
              type="button"
              aria-pressed={session.lastAction === action}
              disabled={!writable || busy || (action !== "create-critical" && versionPending)}
              onClick={() => void run(action)}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
          {session.message ? <p className={styles.result} role="status">{session.message}</p> : null}
          {session.receipt ? (
            <p className={styles.result}>
              <a href={itsmHref({ id: session.receipt.id, itsmUrl: selected?.itsmUrl ?? null })} target="_blank" rel="noopener noreferrer">
                В ITSM
              </a>
            </p>
          ) : null}
        </div>
        <form className={styles.form} data-surface="surface" onSubmit={(event) => event.preventDefault()}>
          <label className={styles.field}>
            Токен оператора
            <input
              type="password"
              autoComplete="off"
              value={token}
              disabled={busy}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            Активная заявка
            <select
              value={session.selectedId ?? ""}
              disabled={busy}
              onChange={(event) => setSession((current) => selectIncident(current, event.target.value || null))}
            >
              <option value="">Не выбрана</option>
              {options.map((incident) => (
                <option key={incident.id} value={incident.id}>
                  {incident.id} · {incident.stateLabel}
                </option>
              ))}
              {session.selectedId && !options.some((incident) => incident.id === session.selectedId) ? (
                <option value={session.selectedId}>{session.selectedId} · ожидает снимок</option>
              ) : null}
            </select>
          </label>
          <p className={styles.identity}>
            Номер: <span className={styles.number}>{session.selectedId ?? "не выбран"}</span>
          </p>
          <p className={styles.identity}>Статус: {selected?.stateLabel ?? (session.selectedId ? "ожидает снимок" : "не выбран")}</p>
          <fieldset className={styles.field}>
            <legend>Срок</legend>
            <div className={styles.choice}>
              <label>
                <input
                  type="radio"
                  name="deadline"
                  checked={session.deadlineChoice === "plus90"}
                  disabled={busy}
                  onChange={() => setSession((current) => chooseDeadline(current, "plus90"))}
                />
                через 90 секунд
              </label>
              <label>
                <input
                  type="radio"
                  name="deadline"
                  checked={session.deadlineChoice === "custom"}
                  disabled={busy}
                  onChange={() => setSession((current) => chooseDeadline(current, "custom"))}
                />
                другое время
              </label>
            </div>
            <input
              type="datetime-local"
              value={session.customDeadline}
              disabled={busy || session.deadlineChoice !== "custom"}
              onChange={(event) => setSession((current) => chooseDeadline(current, "custom", event.target.value))}
            />
          </fieldset>
          <label className={styles.field}>
            Решение
            <textarea
              rows={4}
              maxLength={1000}
              value={session.solution}
              disabled={busy}
              onChange={(event) => setSession((current) => editSolution(current, event.target.value))}
            />
          </label>
        </form>
      </div>
      <section aria-label="Журнал действий">
        <h2 className={styles.identity}>Журнал</h2>
        {session.journal.length === 0 ? <p className={styles.meta}>Журнал пуст</p> : (
          <ol className={styles.journal}>
            {session.journal.map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <time className={styles.time} dateTime={entry.at}>{formatTime(entry.at)}</time>
                <span className={styles.number}>{entry.id ?? "без номера"}</span>
                <span>{entry.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className={styles.reset} aria-label="Сброс демо">
        <p>{messages.resetHint}</p>
        <Dialog.Root open={confirmReset} onOpenChange={setConfirmReset}>
          <Dialog.Trigger asChild>
            <button type="button" disabled={!writable || busy}>Сбросить демо</button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="overlay" />
            <Dialog.Content className={styles.confirm} data-surface="surface">
              <Dialog.Title>Сбросить демо</Dialog.Title>
              <Dialog.Description>{messages.resetHint}</Dialog.Description>
              <div className={styles.confirmActions}>
                <button type="button" onClick={() => void confirmAndReset()}>Подтвердить сброс</button>
                <Dialog.Close className={styles.reset}>Отмена</Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </section>
    </section>
  );
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}
