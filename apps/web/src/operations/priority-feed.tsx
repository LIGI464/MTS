import { PRIORITY_LABELS, type PriorityFeed as FeedResult, type PriorityRecommendation } from "@mts/contracts";
import { formatDuration } from "../board/format";
import type { usePriorityFeed } from "../data/use-priority-feed";
import { Icon } from "../icons";
import styles from "./priority-feed.module.css";

export type ChosenRecommendation = { entry: PriorityRecommendation; source: FeedResult["source"] };

export function PriorityFeed({ data, nowMs, onChoose }: {
  data: ReturnType<typeof usePriorityFeed>;
  nowMs: number;
  onChoose: (recommendation: ChosenRecommendation, opener: HTMLButtonElement) => void;
}) {
  const { result, status } = data;
  const message = status === "error" ? "Не удалось обновить рекомендации."
    : status === "updating" ? "Обновляем рекомендации…"
    : status === "loading" ? "Подбираем рекомендации…"
    : result?.fallback ? "Расчёт ИИ временно недоступен."
    : null;

  return (
    <section className={styles.feed} aria-labelledby="priority-feed-heading">
      <header className={styles.heading}>
        <h2 id="priority-feed-heading" tabIndex={-1}>В работу сейчас</h2>
        <div className={styles.state}>
          {result?.source === "rules" ? <span>Локальные правила</span> : null}
          {message ? <p role="status">{message}</p> : null}
        </div>
      </header>
      {result && result.recommendations.length > 0 ? (
        <ol className={styles.cards}>
          {result.recommendations.map((entry) => {
            const { label, tone } = recommendationLabel(entry, nowMs);
            return (
              <li key={entry.incidentId}>
                <button type="button" className={styles.card} data-tone={tone}
                  onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })}
                  onClick={(event) => onChoose({ entry, source: result.source }, event.currentTarget)}>
                  <span className={styles.identity}>
                    <span className={styles.rank} data-numeric="tabular">{entry.rank}</span>
                    <span className={styles.id} data-numeric="tabular">{entry.incidentId}</span>
                    <Icon name="chevron-right" size={14} />
                  </span>
                  <span className={styles.label}>{label}</span>
                  <span className={styles.title}>{entry.title}</span>
                  <span className={styles.reason}>
                    <strong>{result.source === "llm" ? "Почему сейчас · ИИ" : "Почему сейчас"}</strong>
                    <span>{entry.reason}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : result && status === "ready" ? (
        <p className={styles.empty}>Нет заявок, требующих действий сейчас</p>
      ) : null}
    </section>
  );
}

function recommendationLabel(entry: PriorityRecommendation, nowMs: number) {
  if (entry.priority === 4) return { label: "Критический", tone: "critical" };
  if (entry.sla === "overdue") return { label: "SLA просрочен", tone: "overdue" };
  if (entry.sla === "near" && entry.dueAt) {
    return { label: `До SLA ${formatDuration(Math.max(0, Date.parse(entry.dueAt) - nowMs))}`, tone: "near" };
  }
  if (entry.target === "coordinator") return { label: "У координаторов", tone: "normal" };
  const priority = PRIORITY_LABELS[entry.priority];
  return { label: `${priority} приоритет в ITSM`, tone: "normal" };
}
