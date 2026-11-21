import type { ReactNode } from "react";
import { NO_INCIDENT_DESCRIPTION, type Incident } from "@mts/contracts";
import { Icon, type IconName } from "../icons";
import { CoordinatorValue } from "./coordinator";
import { presentSla } from "./format";
import { itsmHref } from "./itsm";
import { incidentCoordinator, PRIORITIES } from "./model";
import type { IncidentAttention } from "../operations/activity";
import type { QueueTarget, SlaCategory } from "../operations/use-queue-navigation";
import { PRIMARY_QUEUES, PRIORITY_QUEUES, QUEUE_LABELS, SLA_QUEUES, queueId,
  type QueueCategory, type QueueMembers } from "../operations/queue-summary";
import styles from "./board.module.css";

export function IncidentBoard({ queues, nowMs, attention, descriptions, target, expandedSla, onToggleSla, onInspect }: {
  queues: QueueMembers;
  nowMs: number;
  attention: ReadonlyMap<QueueCategory, ReadonlyMap<string, IncidentAttention>>;
  descriptions: ReadonlyMap<string, string>;
  target: (category: QueueCategory, id: string) => QueueTarget | undefined;
  expandedSla: Readonly<Record<SlaCategory, boolean>>;
  onToggleSla: (category: SlaCategory) => void;
  onInspect: (category: QueueCategory, id: string, key: string | null) => void;
}) {
  function renderCards(category: QueueCategory) {
    const incidents = queues[category];
    return incidents.length > 0 ? (
      <div className={styles.cards}>
        {incidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} nowMs={nowMs}
            newSequence={attention.get(category)?.get(incident.id)?.key}
            description={descriptions.get(incident.id) ?? NO_INCIDENT_DESCRIPTION}
            selected={Boolean(target(category, incident.id))}
            onInspect={(key) => onInspect(category, incident.id, key)} />
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
            const open = expandedSla[category];
            return (
              <section key={category} id={id} className={styles.deadline} aria-labelledby={`${id}-label`}
                data-expanded={open || undefined} tabIndex={-1}>
                <h4 className={styles.deadlineHeading}>
                  <button type="button" className={styles.deadlineToggle} data-sla-toggle
                    aria-expanded={open} aria-controls={`${id}-body`} aria-labelledby={`${id}-label ${id}-count`}
                    onClick={() => onToggleSla(category)}>
                    <span id={`${id}-label`}>{label}</span>
                    <span id={`${id}-count`} className={styles.count} data-numeric="tabular">{queues[category].length}</span>
                    <Icon name="chevron-down" size={14} />
                  </button>
                </h4>
                <div id={`${id}-body`} className={styles.deadlineBody} hidden={!open}>
                  {open ? renderCards(category) : null}
                </div>
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
  description,
  selected,
  onInspect,
}: {
  incident: Incident;
  nowMs: number;
  newSequence?: string;
  description: string;
  selected: boolean;
  onInspect: (key: string | null) => void;
}) {
  const priorityLabel = PRIORITIES.find(({ id }) => id === incident.priority)?.label;
  const coordinator = incidentCoordinator(incident);
  const sla = presentSla(incident, nowMs);
  const tone = sla.tone === "alert" ? styles.alert : sla.tone === "near" ? styles.near : styles.calm;

  return (
    <article data-incident-id={incident.id} className={`${styles.card} ${tone}`}
      data-fresh={newSequence !== undefined || undefined} data-selected={selected || undefined}>
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
        <button type="button" className={styles.title} title={incident.title} data-card-title onClick={() => onInspect(newSequence ?? null)}>
          {incident.title}
        </button>
      </div>
      <p className={styles.description}>{description}</p>
      <p className={styles.coordinator}>
        {coordinator ? <>Координатор{" · "}</> : null}<CoordinatorValue coordinator={coordinator} />
      </p>
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
          <button type="button" className={`${styles.action} ${styles.secondary}`} onClick={() => onInspect(newSequence ?? null)}>
            Подробнее
          </button>
        </div>
      </div>
    </article>
  );
}
