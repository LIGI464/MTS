import type { ReactNode } from "react";
import type { Incident } from "@mts/contracts";
import { Icon, type IconName } from "../icons";
import { CoordinatorValue } from "./coordinator";
import { formatMoscow, presentSla } from "./format";
import { itsmHref } from "./itsm";
import { displayText, incidentCoordinator, PRIORITIES } from "./model";
import type { IncidentAlert } from "../operations/activity";
import { PRIMARY_QUEUES, PRIORITY_QUEUES, QUEUE_LABELS, SLA_QUEUES, queueId,
  type QueueCategory, type QueueMembers } from "../operations/queue-summary";
import styles from "./board.module.css";

export function IncidentBoard({ queues, nowMs, highlight, onInspect }: {
  queues: QueueMembers;
  nowMs: number;
  highlight?: IncidentAlert | null;
  onInspect: (id: string) => void;
}) {
  function renderCards(category: QueueCategory) {
    const incidents = queues[category];
    return incidents.length > 0 ? (
      <div className={styles.cards}>
        {incidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} nowMs={nowMs}
            newSequence={highlight?.incidentIds.has(incident.id) ? highlight.sequence : undefined}
            onInspect={onInspect} />
        ))}
      </div>
    ) : (
      <p className={styles.empty}><span><Icon name="check-circle" /></span>Нет инцидентов</p>
    );
  }

  function renderQueue(category: QueueCategory) {
    const { label, icon } = QUEUE_LABELS[category];
    const id = queueId(category);
    return (
      <QueueGroup key={category} id={id} label={label} icon={icon} count={queues[category].length}>
        {renderCards(category)}
      </QueueGroup>
    );
  }

  return (
    <div className={styles.board}>
      {PRIMARY_QUEUES.map(renderQueue)}
      <QueueGroup id="queue-deadlines" label="Сроки" icon="stopwatch" count={queues.near.length + queues.overdue.length}>
        <div className={styles.deadlines}>
          {SLA_QUEUES.map((category) => {
            const id = queueId(category);
            const { label } = QUEUE_LABELS[category];
            return (
              <section key={category} id={id} className={styles.deadline} aria-labelledby={`${id}-heading`} tabIndex={-1}>
                <header className={styles.groupHead}>
                  <h4 id={`${id}-heading`}>{label}</h4>
                  <span className={styles.count} data-numeric="tabular">{queues[category].length}</span>
                </header>
                {renderCards(category)}
              </section>
            );
          })}
        </div>
      </QueueGroup>
      {PRIORITY_QUEUES.map(renderQueue)}
    </div>
  );
}

function QueueGroup({ id, label, icon, count, children }: {
  id: string;
  label: string;
  icon: IconName;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className={styles.group} id={id} aria-labelledby={`${id}-heading`} data-surface="surface" tabIndex={-1}>
      <header className={styles.groupHead}>
        <span className={styles.groupIcon}><Icon name={icon} /></span>
        <h3 id={`${id}-heading`}>{label}</h3>
        <span className={styles.count} data-numeric="tabular">{count}</span>
      </header>
      {children}
    </section>
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
  const priorityLabel = PRIORITIES.find(({ id }) => id === incident.priority)?.label;
  const coordinator = incidentCoordinator(incident);
  const sla = presentSla(incident, nowMs);
  const tone = sla.tone === "alert" ? styles.alert : sla.tone === "near" ? styles.near : styles.calm;

  return (
    <article data-incident-id={incident.id} className={`${styles.card} ${tone}`} data-fresh={newSequence !== undefined ? "true" : undefined}>
      <div className={styles.cardHeading}>
        <span className={styles.id} data-numeric="tabular">{incident.id}</span>
        <div className={styles.badges}>
          <span className={styles.priority} data-priority={incident.priority}>{priorityLabel}</span>
          <span className={styles.status}>{incident.stateLabel}</span>
          {newSequence !== undefined ? (
            <span key={newSequence} className={styles.newMarker}><span className={styles.newLabel}>Новый</span></span>
          ) : null}
        </div>
      </div>
      <div className={styles.titleRow}>
        <button type="button" className={styles.title} title={incident.title} onClick={() => onInspect(incident.id)}>
          {incident.title}
        </button>
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
          {coordinator ? <>Координатор{" · "}</> : null}<CoordinatorValue coordinator={coordinator} />
        </p>
      </div>
      <div className={styles.cardFooter}>
        <p className={styles.time} data-numeric="tabular" title={sla.hint}>
          <Icon name="clock" size={14} />
          <span>{sla.status}</span>
          {sla.duration ? <span>{sla.duration}</span> : null}
        </p>
        <div className={styles.actions}>
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
