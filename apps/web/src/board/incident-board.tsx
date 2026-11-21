import type { Incident, Snapshot } from "@mts/contracts";
import { ArrowUpRight, Clock, ScanSearch, ShieldAlert, Timer, Users } from "lucide-react";
import { formatMoscow, presentSla } from "./format";
import { itsmHref } from "./itsm";
import { cardsForGroup, displayText, GROUP_ORDER } from "./model";
import type { IncidentAlert } from "../operations/activity";
import styles from "./board.module.css";

const groupIcons = { critical: ShieldAlert, coordinator: Users, high: Timer, research: ScanSearch };

export function IncidentBoard({
  snapshot,
  nowMs,
  highlight,
  onInspect,
}: {
  snapshot: Snapshot;
  nowMs: number;
  highlight?: IncidentAlert | null;
  onInspect: (id: string) => void;
}) {
  return (
    <div className={styles.board}>
      {GROUP_ORDER.map(([key, title]) => {
        const cards = cardsForGroup(snapshot, key);
        const Icon = groupIcons[key];
        return (
          <section className={styles.group} key={key} aria-label={title} data-surface="surface" data-group={key}>
            <header className={styles.groupHead}>
              <span className={styles.groupIcon}><Icon size={16} aria-hidden /></span>
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
                    newSequence={highlight?.incidentIds.has(card.id) ? highlight.sequence : undefined}
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
  newSequence,
  onInspect,
}: {
  incident: Incident;
  nowMs: number;
  newSequence?: number;
  onInspect: (id: string) => void;
}) {
  const sla = presentSla(incident, nowMs);
  const tone = sla.tone === "alert" ? styles.alert : sla.tone === "near" ? styles.near : styles.calm;

  return (
    <article className={`${styles.card} ${tone}`} data-fresh={newSequence !== undefined ? "true" : undefined}>
      <div className={styles.cardHeading}>
        <span className={styles.id} data-numeric="tabular">{incident.id}</span>
        <span className={styles.status}>{incident.stateLabel}</span>
      </div>
      <div className={styles.titleRow}>
        <button type="button" className={styles.title} title={incident.title} onClick={() => onInspect(incident.id)}>
          {incident.title}
        </button>
        {newSequence !== undefined ? <span key={newSequence} className={styles.newLabel}>Новый</span> : null}
      </div>
      <p className={styles.product}>
        {displayText(incident.product, "Продукт не указан")}
        {" · "}
        {displayText(incident.service, "Сервис не указан")}
      </p>
      <div className={styles.meta}>
        <p data-numeric="tabular">Регистрация {formatMoscow(incident.createdAt)}</p>
        <p>{displayText(incident.assignee, incident.team ? "Исполнитель не назначен" : "Назначение не указано")}</p>
        <p>{displayText(incident.team, "Группа не назначена")}</p>
      </div>
      <div className={styles.cardFooter}>
        <p className={styles.time} data-numeric="tabular" title={sla.hint}>
          <Clock size={14} aria-hidden />
          <span>{sla.status}</span>
          {sla.duration ? <span>{sla.duration}</span> : null}
        </p>
        <div className={styles.actions}>
          <a className={`${styles.action} ${styles.primary}`} href={itsmHref(incident)} target="_blank" rel="noopener noreferrer">
            В ITSM <ArrowUpRight size={14} aria-hidden />
          </a>
          <button type="button" className={`${styles.action} ${styles.secondary}`} onClick={() => onInspect(incident.id)}>
            Детали
          </button>
        </div>
      </div>
    </article>
  );
}
