import type { Incident } from "@mts/contracts";
import { Icon, type IconName } from "../icons";
import { formatMoscow, presentSla } from "./format";
import { itsmHref } from "./itsm";
import { displayText, incidentCoordinator, PRIORITIES, priorityQueues } from "./model";
import type { IncidentAlert } from "../operations/activity";
import styles from "./board.module.css";

const groupIcons = {
  4: "shield-exclamation",
  3: "stopwatch",
  2: "dash-lg",
  1: "reception-1",
} satisfies Record<Incident["priority"], IconName>;

export function IncidentBoard({
  incidents,
  nowMs,
  highlight,
  onInspect,
  onAssign,
}: {
  incidents: readonly Incident[];
  nowMs: number;
  highlight?: IncidentAlert | null;
  onInspect: (id: string) => void;
  onAssign: (id: string) => void;
}) {
  const queues = priorityQueues(incidents);
  return (
    <div className={styles.board}>
      {PRIORITIES.map(({ id: key, title, label }) => {
        const cards = queues[key];
        return (
          <section className={styles.group} key={key} aria-label={title} data-surface="surface" data-group={key}>
            <header className={styles.groupHead}>
              <span className={styles.groupIcon}><Icon name={groupIcons[key]} /></span>
              <h2>{title}</h2>
              <span className={styles.count} data-numeric="tabular">{cards.length}</span>
            </header>
            {cards.length === 0 ? <p className={styles.empty}>Нет инцидентов</p> : null}
            <div className={styles.cards}>
              {cards.map((incident) => (
                <IncidentCard key={incident.id} incident={incident} priorityLabel={label} nowMs={nowMs}
                  newSequence={highlight?.incidentIds.has(incident.id) ? highlight.sequence : undefined}
                  onInspect={onInspect} onAssign={onAssign} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function IncidentCard({
  incident,
  priorityLabel,
  nowMs,
  newSequence,
  onInspect,
  onAssign,
}: {
  incident: Incident;
  priorityLabel: string;
  nowMs: number;
  newSequence?: number;
  onInspect: (id: string) => void;
  onAssign: (id: string) => void;
}) {
  const coordinator = incidentCoordinator(incident);
  const sla = presentSla(incident, nowMs);
  const tone = sla.tone === "alert" ? styles.alert : sla.tone === "near" ? styles.near : styles.calm;

  return (
    <article data-incident-id={incident.id} className={`${styles.card} ${tone}`} data-fresh={newSequence !== undefined ? "true" : undefined}>
      <div className={styles.cardHeading}>
        <span className={styles.id} data-numeric="tabular">{incident.id}</span>
        <div className={styles.badges}>
          <span className={styles.priority}>{priorityLabel}</span>
          <span className={styles.status}>{incident.stateLabel}</span>
        </div>
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
        <p className={styles.coordinator}>
          {coordinator ? `Координатор · ${coordinator.name}` : "Координатор не назначен"}
        </p>
      </div>
      <div className={styles.cardFooter}>
        <p className={styles.time} data-numeric="tabular" title={sla.hint}>
          <Icon name="clock" size={14} />
          <span>{sla.status}</span>
          {sla.duration ? <span>{sla.duration}</span> : null}
        </p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.action} ${styles.assignment}`} onClick={() => onAssign(incident.id)}>
            {coordinator ? "Сменить координатора" : "Назначить координатора"}
          </button>
          <a className={`${styles.action} ${styles.primary}`} href={itsmHref(incident)} target="_blank" rel="noopener noreferrer">
            В ITSM <Icon name="box-arrow-up-right" size={14} />
          </a>
          <button type="button" className={`${styles.action} ${styles.secondary}`} onClick={() => onInspect(incident.id)}>
            Подробнее
          </button>
        </div>
      </div>
    </article>
  );
}
