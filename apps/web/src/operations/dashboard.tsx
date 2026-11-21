import { Icon } from "../icons";
import { PRIMARY_QUEUES, QUEUE_LABELS, SUMMARY_SEGMENTS, queueId, type QueueCategory, type QueueMembers } from "./queue-summary";
import styles from "./dashboard.module.css";

export function SoundButton({ enabled, unavailable, activating, toggle }: {
  enabled: boolean;
  unavailable: boolean;
  activating: boolean;
  toggle: () => void;
}) {
  return (
    <button type="button" className={styles.sound} aria-label="Звук оповещений"
      aria-pressed={enabled} disabled={activating} onClick={toggle}>
      <Icon name={enabled ? "bell" : "bell-slash"} size={17} />
      <span>{unavailable ? "Звук недоступен" : enabled ? "Звук вкл." : "Звук выкл."}</span>
    </button>
  );
}

export function DashboardMetrics({ queues, onJump }: {
  queues: QueueMembers;
  onJump: (category: QueueCategory) => void;
}) {
  return (
    <div className={styles.summary} role="group" aria-label="Сводка инцидентов" aria-describedby="queue-count-note">
      <div className={styles.summaryMain}>
        {PRIMARY_QUEUES.map((category) => (
          <QueueMetric key={category} category={category} count={queues[category].length} onJump={onJump} primary />
        ))}
      </div>
      <div className={styles.summaryStrip}>
        {SUMMARY_SEGMENTS.map((category) => (
          <QueueMetric key={category} category={category} count={queues[category].length} onJump={onJump} />
        ))}
      </div>
    </div>
  );
}

function QueueMetric({ category, count, onJump, primary = false }: {
  category: QueueCategory;
  count: number;
  onJump: (category: QueueCategory) => void;
  primary?: boolean;
}) {
  const { label, icon } = QUEUE_LABELS[category];
  return (
    <button type="button" className={primary ? styles.summaryCard : styles.summarySegment}
      data-category={category} aria-controls={queueId(category)} onClick={() => onJump(category)}>
      <span className={styles.summaryLabel}><span><Icon name={icon} size={primary ? 21 : 16} /></span>{label}</span>
      <strong data-numeric="tabular">{count}</strong>
      {primary ? <span className={styles.summaryArrow}><Icon name="arrow-down" size={20} /></span> : null}
    </button>
  );
}
