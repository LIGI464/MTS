import type { Notice, Snapshot } from "@mts/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IncidentBoard } from "./board";
import { IncidentDetails } from "./board/incident-details";
import { uniqueIncidents } from "./board/model";
import type { DemoStep, useDashboard } from "./data";
import { coordinatorQuery } from "./data/incidents";
import { Icon } from "./icons";
import { ActivityPanel } from "./operations/activity-panel";
import { DashboardMetrics, SoundButton } from "./operations/dashboard";
import { IncidentFilters } from "./operations/filters";
import { buildQueues, DEFAULT_FILTERS, QUEUE_LABELS, SUMMARY_SEGMENTS, PRIMARY_QUEUES, type QueueFilters } from "./operations/queue-summary";
import { useFilteredIncidents } from "./operations/use-filtered-incidents";
import { useQueueNavigation } from "./operations/use-queue-navigation";
import type { useIncidentAlerts } from "./operations/use-incident-alerts";
import type { useIncidentSound } from "./operations/use-incident-sound";
import operationsStyles from "./operations/dashboard.module.css";
import { AppShell } from "./shell";
import { EventsButton } from "./shell/events-button";

const STEPS: Array<[DemoStep, string]> = [
  ["critical", "Критический"], ["assign", "Имитировать обновление ITSM"], ["deadline", "Срок"], ["resolve", "Решение"],
];
const EMPTY_GROUPS = { critical: [], coordinator: [] };
const COUNT_NOTE = "Сводка показывает общий состав рабочих очередей. Счётчики ниже учитывают фильтры.";

export function App({ dashboard, operatorToken, activity, sound }: {
  dashboard: ReturnType<typeof useDashboard>;
  operatorToken: string | undefined;
  activity: ReturnType<typeof useIncidentAlerts>;
  sound: ReturnType<typeof useIncidentSound>;
}) {
  const [selection, setSelection] = useState<{ id: string; attentionKey?: string } | null>(null);
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS);
  const opener = useRef<HTMLElement | null>(null);
  const snapshot = dashboard.snapshot;
  const incidents = useMemo(() => uniqueIncidents(snapshot?.incidents ?? []), [snapshot]);
  const groups = snapshot?.groups ?? EMPTY_GROUPS;
  const coordinatorIds = useMemo(() => new Set(groups.coordinator), [groups.coordinator]);
  const selected = incidents.find(({ id }) => id === selection?.id);
  const directory = useQuery({ ...coordinatorQuery(dashboard.incidentClient), enabled: Boolean(snapshot) });
  const filtered = useFilteredIncidents(incidents, filters, dashboard.nowMs, coordinatorIds, dashboard.incidentClient, snapshot?.revision);
  const summary = buildQueues(incidents, groups, dashboard.nowMs);
  const queues = buildQueues(filtered.incidents, groups, dashboard.nowMs, filters.status !== "default" && filters.status !== "active");
  const countsDiffer = [...PRIMARY_QUEUES, ...SUMMARY_SEGMENTS].some((category) => summary[category].length !== queues[category].length);
  const { markViewed, resetSequence } = activity;
  const navigation = useQueueNavigation(queues, summary, activity.pending, resetSequence, markViewed);

  useEffect(() => {
    if (resetSequence < 0) return;
    setSelection(null);
    setFilters(DEFAULT_FILTERS);
  }, [resetSequence]);

  function select(id: string, key?: string | null) {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const guessed = key === undefined ? activity.pending.find((entry) => entry.incidentId === id)?.key : key;
    setSelection({ id, attentionKey: guessed ?? undefined });
  }

  const detailOpened = useCallback(() => {
    if (selection?.attentionKey) markViewed(selection.attentionKey);
  }, [selection, markViewed]);

  function returnFocus() {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else document.getElementById("incident-search")?.focus({ preventScroll: true });
  }

  function changeFilters(patch: Partial<QueueFilters>) {
    navigation.cancel();
    setFilters((previous) => ({ ...previous, ...patch }));
  }

  return (
    <AppShell
      title="Пульт координатора"
      headerActions={
        <>
          <ActivityPanel events={activity.events} unreadCount={activity.journalUnread.size} markRead={activity.markJournalRead}
            onInspect={(id, eventKey) => select(id, activity.pending.find((entry) => entry.eventKeys.includes(eventKey))?.key ?? null)}>
            <EventsButton count={activity.journalUnread.size} />
          </ActivityPanel>
          <SoundButton {...sound} />
        </>
      }
      healthBadge={
        <span className="health-text" role="status" data-live={dashboard.connection === "live" && snapshot?.source.status === "ok"}>
          {badgeText(dashboard.connection, snapshot)}
        </span>
      }
      footerSlot={dashboard.stepMock ? (
        <div className="mock-steps">
          {STEPS.map(([step, label]) => (
            <button key={step} type="button" onClick={() => dashboard.stepMock?.(step)}>{label}</button>
          ))}
        </div>
      ) : null}
    >
      {snapshot?.source.status === "stale" ? (
        <p className="banner" role="status">Показан последний сохранённый снимок. Источник устарел.</p>
      ) : null}
      {snapshot?.source.status === "unavailable" ? <p className="banner" role="status">Файл временно недоступен</p> : null}
      {dashboard.newNotices.length > 0 ? (
        <div className="toasts" aria-label="Оповещения">
          {dashboard.newNotices.map((notice) => (
            <article key={notice.seq} className={notice.kind === "critical.resolved" ? "toast resolved" : "toast"}>
              <p>{noticeLine(notice)}</p>
              <button type="button" aria-label="Закрыть оповещение" onClick={() => dashboard.dismissNotice(notice.seq)}>
                <Icon name="x-lg" size={16} />
              </button>
            </article>
          ))}
        </div>
      ) : null}
      {!snapshot && dashboard.connection === "connecting" ? <div className="skeleton" aria-busy="true">Загрузка очереди</div> : null}
      {!snapshot && dashboard.connection !== "connecting" ? <p className="empty-screen">Нет данных</p> : null}
      {snapshot ? (
        <>
          <DashboardMetrics queues={summary} pending={activity.pending} onJump={navigation.jump} />
          <section aria-labelledby="queue-heading" aria-busy={filtered.loading}>
            <div className={operationsStyles.queueHeader}>
              <h2 id="queue-heading">Очереди инцидентов</h2>
              <p role="status" data-numeric="tabular">
                {filtered.loading ? "Проверяем поля заявок…" : `Показано ${filtered.incidents.length} из ${incidents.length}`}
              </p>
            </div>
            <IncidentFilters filters={filters} incidents={incidents} coordinators={directory.data ?? []} onChange={changeFilters} />
            <p id="queue-count-note" className={countsDiffer ? operationsStyles.countNote : "sr-only"}>{COUNT_NOTE}</p>
            {filtered.failures > 0 ? (
              <p className="banner" role="alert">
                Не удалось проверить поля заявок ({filtered.failures}).{" "}
                <button type="button" onClick={filtered.retry}>Повторить</button>
              </p>
            ) : null}
            {navigation.revealed ? (
              <p className={operationsStyles.countNote} role="status">
                Заявка {navigation.revealed.id} показана вне фильтров в очереди «{QUEUE_LABELS[navigation.revealed.category].label}».
              </p>
            ) : null}
            <IncidentBoard queues={navigation.queues} nowMs={dashboard.nowMs} attention={activity.queues}
              pulse={navigation.pulse} onPulseEnd={navigation.finishPulse} onInspect={select} />
          </section>
        </>
      ) : null}
      {selection ? (
        <IncidentDetails key={selection.id} id={selection.id} incident={selected}
          nowMs={dashboard.nowMs} client={dashboard.incidentClient} revision={snapshot?.revision} operatorToken={operatorToken}
          runAnalysis={dashboard.runAnalysis} onShown={detailOpened}
          onClose={() => setSelection(null)} onReturnFocus={returnFocus} />
      ) : null}
    </AppShell>
  );
}

function badgeText(
  connection: "connecting" | "live" | "reconnecting" | "mock",
  snapshot: Snapshot | null,
): string {
  if (connection === "mock") return "Демонстрационные данные";
  if (connection === "reconnecting") return "Переподключение";
  if (snapshot?.source.status === "unavailable") return "Файл временно недоступен";
  if (snapshot?.source.status === "stale") return "Источник устарел";
  if (connection === "live") return "Данные актуальны";
  return "Данные загружаются";
}

function noticeLine(notice: Notice): string {
  const id = notice.incidentId ? ` ${notice.incidentId}` : "";
  if (notice.kind === "critical.resolved") return `Критический инцидент решён${id}`;
  if (notice.kind === "critical.new") {
    return `Новый критический инцидент${id}${notice.title ? `: ${notice.title}` : ""}`;
  }
  if (notice.kind === "coordinator.assigned") {
    return `Назначен координаторам${id}${notice.title ? `: ${notice.title}` : ""}`;
  }
  if (notice.kind === "coordinator.changed") return `Координатор изменён${id}`;
  if (notice.kind === "demo.reset") return notice.title ?? "Набор восстановлен";
  return notice.title ?? "Событие";
}
