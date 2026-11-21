import type { Incident, Snapshot } from "@mts/contracts";
import { AlertTriangle, Clock } from "lucide-react";
import { formatMoscow, presentSla } from "./format";
import { itsmHref } from "./itsm";
import { cardsForGroup, displayText, GROUP_ORDER } from "./model";
import styles from "./board.module.css";

export function IncidentBoard({
  snapshot,
  nowMs,
  onInspect,
}: {
  snapshot: Snapshot;
  nowMs: number;
  onInspect: (id: string) => void;
}) {
  return (
    <div className={styles.board}>
      {GROUP_ORDER.map(([key, title]) => {
        const cards = cardsForGroup(snapshot, key);
        return (
          <section className={styles.group} key={key} aria-label={title} data-surface="surface">
            <header className={styles.groupHead}>
              <h2>{title}</h2>
              <span className={styles.count} data-numeric="tabular">{cards.length}</span>
            </header>
            {cards.length === 0 ? <p className={styles.empty}>Нет инцидентов</p> : null}
            <div className={styles.cards}>
              {cards.map((card) =>
                card.incident ? (
                  <IncidentCard
                    key={card.id}
                    incident={card.incident}
                    nowMs={nowMs}
                    onInspect={onInspect}
                  />
                ) : null,
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function IncidentCard({
  incident,
  nowMs,
  onInspect,
}: {
  incident: Incident;
  nowMs: number;
  onInspect: (id: string) => void;
}) {
  const sla = presentSla(incident, nowMs);
  const tone = sla.tone === "alert" ? styles.alert : sla.tone === "near" ? styles.near : styles.calm;

  return (
    <article className={`${styles.card} ${tone}`}>
      <button type="button" className={styles.title} title={incident.title} onClick={() => onInspect(incident.id)}>
        {incident.title}
      </button>
      <p className={styles.id} data-numeric="tabular">{incident.id}</p>
      <p>
        {displayText(incident.product, "Продукт не указан")}
        {" · "}
        {displayText(incident.service, "Сервис не указан")}
      </p>
      <p className={styles.time} data-numeric="tabular" title={formatMoscow(incident.createdAt)}>
        Регистрация {formatMoscow(incident.createdAt)}
      </p>
      <p>{displayText(incident.assignee, incident.team ? "Исполнитель не назначен" : "Назначение не указано")}</p>
      <p>{displayText(incident.team, "Группа не назначена")}</p>
      <p>{incident.stateLabel}</p>
      <p className={styles.time} data-numeric="tabular" title={sla.hint}>
        <Clock size={15} aria-hidden />
        {sla.tone === "near" ? <AlertTriangle size={15} aria-hidden /> : null}
        <span>{sla.status}</span>
        {sla.duration ? <span>{sla.duration}</span> : null}
      </p>
      <div className={styles.actions}>
        <a className={`${styles.action} ${styles.primary}`} href={itsmHref(incident)} target="_blank" rel="noopener noreferrer">
          В ITSM
        </a>
        <button type="button" className={`${styles.action} ${styles.secondary}`} onClick={() => onInspect(incident.id)}>
          Детали
        </button>
      </div>
    </article>
  );
}
