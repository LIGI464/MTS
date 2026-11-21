import { isActiveState, type MutationResult, type ResolveIncident, type TicketDetail, type TicketSummary } from "@mts/contracts";
import { useId, useRef, useState, type FormEvent } from "react";
import { ItsmRequestError, resolveTicket } from "./api";
import { confirmsResolution } from "./model";
import styles from "./itsm.module.css";

type Feedback = { kind: "conflict" | "error" | "saved"; message: string };

export function ResolvePanel({ ticket, operatorToken, refresh }: {
  ticket: TicketSummary;
  operatorToken: string | undefined;
  refresh: (revision?: number) => Promise<TicketDetail>;
}) {
  const label = useId();
  const [draft, setDraft] = useState("");
  const [draftVersion, setDraftVersion] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const [receipt, setReceipt] = useState<MutationResult>();
  const inFlight = useRef(false);
  const intent = useRef<ResolveIncident | undefined>(undefined);
  const eligible = ticket.present && isActiveState(ticket.state);
  const canEdit = eligible && Boolean(operatorToken);
  const solution = draft.trim();
  const tooLong = Array.from(solution).length > 1000;
  const locked = busy || Boolean(receipt);

  if (!canEdit && !draft && !feedback) return null;

  async function verify(result: MutationResult) {
    const fresh = await refresh(result.revision);
    if (!confirmsResolution(fresh, result, solution)) throw new Error("Unconfirmed resolution");
    setReceipt(undefined);
    setDraft("");
    setDraftVersion(undefined);
    intent.current = undefined;
    setFeedback({ kind: "saved", message: "Решение сохранено. Изменение появилось в хронологии." });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!operatorToken || !canEdit || !solution || tooLong || receipt || feedback?.kind === "conflict" || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFeedback(undefined);
    let result: MutationResult | undefined;
    try {
      const expectedVersion = draftVersion ?? ticket.version;
      if (intent.current?.expectedVersion !== expectedVersion || intent.current.solution !== solution) {
        intent.current = { requestId: crypto.randomUUID(), expectedVersion, solution };
      }
      result = await resolveTicket(ticket.id, operatorToken, intent.current);
      setReceipt(result);
      await verify(result);
    } catch (error) {
      if (result) {
        setFeedback({ kind: "error", message: "Не удалось подтвердить сохранение. Проверьте карточку ещё раз." });
      } else if (error instanceof ItsmRequestError && error.status === 409) {
        setFeedback({ kind: "conflict", message: "Сохранение отклонено. Перечитайте карточку перед повтором. Текст сохранён в форме." });
      } else if (error instanceof ItsmRequestError && error.status === 403) {
        setFeedback({ kind: "error", message: "Токен оператора отклонён. Проверьте токен и повторите." });
      } else {
        setFeedback({ kind: "error", message: "Не удалось сохранить решение. Повторите запрос." });
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (receipt) await verify(receipt);
      else {
        const fresh = await refresh();
        setDraftVersion(fresh.ticket.version);
        intent.current = undefined;
        setFeedback(undefined);
      }
    } catch {
      if (receipt) setFeedback({ kind: "error", message: "Не удалось подтвердить сохранение. Попробуйте ещё раз." });
      else setFeedback({ kind: "conflict", message: "Не удалось перечитать карточку. Текст сохранён в форме." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby={label}>
      <h2 id={label}>Запись решения</h2>
      {feedback?.kind === "saved" ? <p className={styles.success} role="status">{feedback.message}</p> : null}
      {canEdit || draft ? (
        <form className={styles.resolveForm} onSubmit={submit} aria-busy={busy}>
          <label htmlFor={`${label}-input`}>Текст решения</label>
          <textarea
            id={`${label}-input`}
            rows={4}
            aria-describedby={`${label}-hint`}
            aria-invalid={tooLong || undefined}
            value={draft}
            readOnly={locked || !canEdit}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              setDraftVersion(value ? draftVersion ?? ticket.version : undefined);
              if (feedback?.kind === "error") setFeedback(undefined);
            }}
          />
          <p id={`${label}-hint`} className={styles.muted}>
            {canEdit ? (tooLong ? "Сократите текст до 1000 символов." : "От 1 до 1000 символов.")
              : eligible ? "Для записи решения требуется доступ оператора." : "Запись решения доступна для активной заявки в текущей выгрузке."}
          </p>
          {feedback && feedback.kind !== "saved" ? <p className={styles.error} role="alert">{feedback.message}</p> : null}
          {receipt || feedback?.kind === "conflict" || (!canEdit && feedback?.kind === "error") ? (
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void reload()}>
              {busy ? "Проверяем…" : "Перечитать карточку"}
            </button>
          ) : canEdit ? (
            <button type="submit" className={styles.primary} disabled={busy || !solution || tooLong}>
              {busy ? "Сохраняем…" : "Сохранить решение"}
            </button>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
