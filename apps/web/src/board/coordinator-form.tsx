import { AssignCoordinatorSchema, type AssignCoordinator, type CoordinatorList, type FullTicketDetail } from "@mts/contracts";
import { useRef, useState } from "react";
import { DashboardRequestError } from "../data/api";
import type { IncidentClient } from "../data/incidents";
import { ProjectLink } from "../shell/navigation";
import styles from "./detail.module.css";
import { incidentCoordinator } from "./model";

type Feedback =
  | { phase: "idle" | "saving" }
  | { phase: "token-required" }
  | { phase: "conflict" | "error"; message: string }
  | { phase: "sent"; revision: number };

export function CoordinatorForm({ id, detail, coordinators, client, operatorToken, sseRevision, busy, reload }: {
  id: string;
  detail: FullTicketDetail | undefined;
  coordinators: CoordinatorList | undefined;
  client: IncidentClient;
  operatorToken?: string;
  sseRevision: number | null;
  busy: boolean;
  reload: () => Promise<boolean>;
}) {
  const [choice, setChoice] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ phase: "idle" });
  const [reloading, setReloading] = useState(false);
  const intent = useRef<AssignCoordinator | null>(null);
  const inFlight = useRef(false);
  const current = detail ? incidentCoordinator(detail.ticket) : null;
  const confirmed = feedback.phase === "sent" && sseRevision !== null && sseRevision >= feedback.revision;
  const pending = feedback.phase === "saving" || (feedback.phase === "sent" && !confirmed);
  const conflicted = feedback.phase === "conflict";
  const available = !!detail?.ticket.present && !!coordinators?.length;
  const disabled = !available || busy || pending || conflicted || reloading;

  async function save() {
    if (disabled || !detail || !choice || choice === current?.id || inFlight.current) return;
    if (!client.mock && !operatorToken?.trim()) {
      setFeedback({ phase: "token-required" });
      return;
    }
    const expectedVersion = detail.ticket.version;
    try {
      inFlight.current = true;
      setFeedback({ phase: "saving" });
      if (intent.current?.coordinatorId !== choice || intent.current.expectedVersion !== expectedVersion) {
        intent.current = AssignCoordinatorSchema.parse({
          coordinatorId: choice, expectedVersion, requestId: crypto.randomUUID(),
        });
      }
      const result = await client.assign(id, intent.current, operatorToken);
      intent.current = null;
      setFeedback({ phase: "sent", revision: result.revision });
    } catch (error) {
      if (error instanceof DashboardRequestError && error.status === 409) {
        intent.current = null;
        setFeedback({ phase: "conflict", message: error.code === "VERSION_CONFLICT"
          ? "Карточка изменилась. Перечитайте её и подтвердите назначение ещё раз."
          : error.message });
      } else {
        setFeedback({ phase: "error", message: error instanceof Error ? error.message : "Не удалось сохранить назначение" });
      }
    } finally {
      inFlight.current = false;
    }
  }

  async function refresh() {
    setReloading(true);
    const success = await reload();
    setReloading(false);
    if (success) setFeedback({ phase: "idle" });
  }

  if (!detail && feedback.phase === "idle") return null;

  return (
    <form className={styles.assignment} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h3>{current ? "Смена координатора" : "Назначение координатора"}</h3>
      {detail && !detail.ticket.present ? <p>В архиве</p> : null}
      {detail?.ticket.present && coordinators?.length === 0 ? <p>Справочник координаторов пуст</p> : null}
      {available ? (
        <div className={styles.formRow}>
          <label>
            <span className="sr-only">Координатор для назначения</span>
            <select value={choice} disabled={pending || reloading} onChange={(event) => {
              const next = event.target.value;
              setChoice(next);
              if (next !== intent.current?.coordinatorId) intent.current = null;
              if (!conflicted) setFeedback({ phase: "idle" });
            }}>
              <option value="">{current ? `Сейчас · ${current.name}` : "Выберите координатора"}</option>
              {coordinators.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <button type="submit" className="brand-action" disabled={disabled || !choice || choice === current?.id}>
            Сохранить
          </button>
        </div>
      ) : null}
      {pending ? <p role="status">{feedback.phase === "saving" ? "Сохранение…" : "Ожидаем обновление от сервера…"}</p> : null}
      {confirmed ? <p role="status">Координатор обновлён</p> : null}
      {feedback.phase === "token-required" ? (
        <p role="alert">Введите токен оператора в разделе «Служебное» на странице <ProjectLink href="/admin/developers">«Разработчикам»</ProjectLink>.</p>
      ) : null}
      {feedback.phase === "conflict" || feedback.phase === "error" ? <p role="alert">{feedback.message}</p> : null}
      {conflicted ? (
        <button type="button" className={styles.button} disabled={reloading} onClick={() => void refresh()}>
          {reloading ? "Загрузка…" : "Перечитать карточку"}
        </button>
      ) : null}
    </form>
  );
}
