import { useState } from "react";
import type { ReactNode } from "react";
import { Activity, AlarmClock, ArrowUpRight, Bell, BellOff, CircleCheck, CirclePlus, Clock, RotateCcw, ShieldAlert, TimerOff, Users } from "lucide-react";
import type { ActivityEvent, IncidentAlert } from "./activity";
import type { QueueFilter, QueueSummary } from "./queue-summary";
import styles from "./dashboard.module.css";

const metrics = {
  active: { label: "Активные", icon: Activity, tone: "info" },
  critical: { label: "Критические", icon: ShieldAlert, tone: "critical" },
  near: { label: "Срок близко", icon: AlarmClock, tone: "warning" },
  overdue: { label: "Просрочены", icon: TimerOff, tone: "critical" },
} as const;

const eventTypes = {
  "incident.new": { label: "Новый инцидент", icon: CirclePlus, tone: "info" },
  "critical.new": { label: "Новый критический инцидент", icon: ShieldAlert, tone: "critical" },
  "coordinator.assigned": { label: "Назначен координаторам", icon: Users, tone: "info" },
  "critical.resolved": { label: "Критический инцидент решён", icon: CircleCheck, tone: "success" },
  "demo.reset": { label: "Набор восстановлен", icon: RotateCcw, tone: "neutral" },
} as const;

const clock = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function SoundButton({ enabled, unavailable, activating, toggle }: {
  enabled: boolean;
  unavailable: boolean;
  activating: boolean;
  toggle: () => void;
}) {
  const Icon = enabled ? Bell : BellOff;
  return (
    <button
      type="button"
      className={styles.sound}
      aria-label="Звук оповещений"
      aria-pressed={enabled}
      disabled={activating}
      onClick={toggle}
    >
      <Icon size={17} aria-hidden />
      {unavailable ? "Звук недоступен" : enabled ? "Звук вкл." : "Звук выкл."}
    </button>
  );
}

export function DashboardMetrics({ summary, filter, onChange }: {
  summary: QueueSummary;
  filter: QueueFilter | null;
  onChange: (filter: QueueFilter | null) => void;
}) {
  return (
    <div className={styles.metrics} role="group" aria-label="Сводка инцидентов">
      {(Object.keys(metrics) as QueueFilter[]).map((key) => {
        const { icon: Icon, label, tone } = metrics[key];
        const active = filter === key;
        return (
          <button
            key={key}
            type="button"
            className={styles.metric}
            aria-pressed={active}
            onClick={() => onChange(active ? null : key)}
          >
            <span className={styles.metricText}>
              <span>{label}</span>
              <strong data-numeric="tabular">{summary[key].size}</strong>
            </span>
            <span className={styles.symbol} data-tone={tone}><Icon size={19} aria-hidden /></span>
          </button>
        );
      })}
    </div>
  );
}

export function DashboardWorkspace({ filter, onClear, children, events }: {
  filter: QueueFilter | null;
  onClear: () => void;
  children: ReactNode;
  events: ReactNode;
}) {
  return (
    <div className={styles.workbench}>
      <section className={styles.queues} aria-labelledby="queue-heading">
        <div className={styles.queueHeader}>
          <h2 id="queue-heading">Очереди инцидентов</h2>
          {filter ? (
            <button type="button" className={styles.resetFilter} onClick={onClear}>
              Показать все
            </button>
          ) : null}
        </div>
        {children}
      </section>
      {events}
    </div>
  );
}

export function ActivityFeed({ events, incidentIds, highlight, onInspect }: {
  events: readonly ActivityEvent[];
  incidentIds: ReadonlySet<string>;
  highlight: IncidentAlert | null;
  onInspect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, 5);

  return (
    <aside className={styles.feed} id="incident-activity" aria-labelledby="activity-heading">
      <div className={styles.feedHeading}>
        <h2 id="activity-heading">События</h2>
        <span>МСК</span>
      </div>
      {visible.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.symbol} data-tone="neutral"><Clock size={21} aria-hidden /></span>
          <p>Событий пока нет</p>
          <span>Новые инциденты и изменения появятся здесь.</span>
        </div>
      ) : (
        <ol className={styles.events}>
          {visible.map((event) => {
            const { icon: Icon, label, tone } = eventTypes[event.kind];
            const inspectable = event.incidentId !== null && incidentIds.has(event.incidentId) ? event.incidentId : null;
            return (
              <li key={event.key} className={styles.event} data-fresh={highlight?.eventKeys.has(event.key) || undefined}>
                <span className={styles.symbol} data-tone={tone}><Icon size={17} aria-hidden /></span>
                <div className={styles.eventInfo}>
                  <div className={styles.eventTop}>
                    <strong>{label}</strong>
                    <time dateTime={event.at}>{clock.format(new Date(event.at))}</time>
                  </div>
                  {inspectable ? (
                    <button type="button" className={styles.eventLink} onClick={() => onInspect(inspectable)}>
                      {event.title ?? inspectable}
                      <ArrowUpRight size={14} aria-hidden />
                    </button>
                  ) : event.title && event.title !== label ? <p>{event.title}</p> : null}
                  {event.incidentId && (event.title || !inspectable) ? (
                    <small data-numeric="tabular">{event.incidentId}</small>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {events.length > 5 ? (
        <button type="button" className={styles.expand} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Свернуть" : "Показать ещё"}
        </button>
      ) : null}
    </aside>
  );
}
