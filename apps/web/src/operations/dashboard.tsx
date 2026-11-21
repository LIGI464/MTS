import { Activity, AlarmClock, Bell, BellOff, ShieldAlert, TimerOff } from "lucide-react";
import type { QueueFilters, QueueSummary } from "./queue-summary";
import styles from "./dashboard.module.css";

const metrics = {
  active: { label: "Активные", icon: Activity, tone: "info" },
  critical: { label: "Критические", icon: ShieldAlert, tone: "critical" },
  near: { label: "Срок близко", icon: AlarmClock, tone: "warning" },
  overdue: { label: "Просрочены", icon: TimerOff, tone: "critical" },
} as const;

export function SoundButton({ enabled, unavailable, activating, toggle }: {
  enabled: boolean;
  unavailable: boolean;
  activating: boolean;
  toggle: () => void;
}) {
  const Icon = enabled ? Bell : BellOff;
  return (
    <button type="button" className={styles.sound} aria-label="Звук оповещений"
      aria-pressed={enabled} disabled={activating} onClick={toggle}>
      <Icon size={17} aria-hidden />
      <span>{unavailable ? "Звук недоступен" : enabled ? "Звук вкл." : "Звук выкл."}</span>
    </button>
  );
}

export function DashboardMetrics({ summary, filters, onChange }: {
  summary: QueueSummary;
  filters: QueueFilters;
  onChange: (patch: Partial<QueueFilters>) => void;
}) {
  return (
    <div className={styles.metrics} role="group" aria-label="Сводка инцидентов">
      {(Object.keys(metrics) as (keyof QueueSummary)[]).map((key) => {
        const { icon: Icon, label, tone } = metrics[key];
        const content = (
          <>
            <span className={styles.metricText}>
              <span>{label}</span>
              <strong data-numeric="tabular">{summary[key]}</strong>
            </span>
            <span className={styles.symbol} data-tone={tone}><Icon size={19} aria-hidden /></span>
          </>
        );
        if (key === "near" || key === "overdue") {
          return <div key={key} className={styles.metric}>{content}</div>;
        }
        const pressed = key === "active" ? filters.status === "active" : filters.priority === 4;
        return (
          <button key={key} type="button" className={styles.metric} aria-pressed={pressed}
            onClick={() => onChange(key === "active" ? { status: pressed ? "all" : "active" } : { priority: pressed ? "" : 4 })}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
