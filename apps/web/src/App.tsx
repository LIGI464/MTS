import {
  matchesPriorityRecommendation, priorityQueueMembership, type Snapshot,
} from "@mts/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantHost } from "./assistant";
import { IncidentBoard } from "./board";
import { IncidentDetails } from "./board/incident-details";
import { uniqueIncidents } from "./board/model";
import type { DemoStep, useDashboard } from "./data";
import { DashboardRequestError } from "./data/api";
import { coordinatorQuery, detailQuery } from "./data/incidents";
import { ActivityPanel } from "./operations/activity-panel";
import { DashboardMetrics, SoundButton } from "./operations/dashboard";
import { IncidentFilters } from "./operations/filters";
import { PriorityFeed, type ChosenRecommendation } from "./operations/priority-feed";
import { buildQueues, DEFAULT_FILTERS, QUEUE_LABELS, SUMMARY_SEGMENTS, PRIMARY_QUEUES, type QueueFilters } from "./operations/queue-summary";
import { useFilteredIncidents } from "./operations/use-filtered-incidents";
import { useQueueNavigation, type QueueTarget } from "./operations/use-queue-navigation";
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
  const [selection, setSelection] = useState<{
    id: string; attentionKey: string | null; target?: QueueTarget; recommendation?: ChosenRecommendation;
  } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS);
  const opener = useRef<{ node: HTMLElement | null; fromFeed: boolean } | null>(null);
  const snapshot = dashboard.snapshot;
  const incidents = useMemo(() => uniqueIncidents(snapshot?.incidents ?? []), [snapshot]);
  const groups = snapshot?.groups ?? EMPTY_GROUPS;
  const coordinatorIds = useMemo(() => new Set(groups.coordinator), [groups.coordinator]);
  const selected = incidents.find(({ id }) => id === selection?.id);
  // Observe the same query as IncidentDetails, which owns the initial fetch.
  const selectedDetail = useQuery({
    ...detailQuery(dashboard.incidentClient, selection?.id ?? "", selected?.version, snapshot?.revision),
    enabled: false,
  });
  const detailFailed = selectedDetail.isError && !selectedDetail.isFetching;
  const detailError = selectedDetail.error instanceof DashboardRequestError
    ? selectedDetail.error.message
    : "Не удалось загрузить данные заявки.";
  const directory = useQuery({ ...coordinatorQuery(dashboard.incidentClient), enabled: Boolean(snapshot) });
  const filtered = useFilteredIncidents(incidents, filters, dashboard.nowMs, coordinatorIds, dashboard.incidentClient, snapshot?.revision);
  const summary = buildQueues(incidents, groups, dashboard.nowMs);
  const queues = buildQueues(filtered.incidents, groups, dashboard.nowMs, filters.status !== "default" && filters.status !== "active");
  const countsDiffer = [...PRIMARY_QUEUES, ...SUMMARY_SEGMENTS].some((category) => summary[category].length !== queues[category].length);
  const { markViewed, resetSequence } = activity;
  const navigation = useQueueNavigation(queues, summary, activity.pending, resetSequence);
  const inspectTarget = navigation.inspect;

  useEffect(() => {
    if (resetSequence < 0) return;
    setSelection(null);
    setFilters(DEFAULT_FILTERS);
  }, [resetSequence]);

  function select(
    id: string, attentionKey: string | null, target?: QueueTarget,
    recommendation?: ChosenRecommendation, source?: HTMLElement,
  ) {
    const node = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    opener.current = { node, fromFeed: Boolean(recommendation) };
    setSelection({ id, attentionKey, target, recommendation });
  }

  function chooseRecommendation(recommendation: ChosenRecommendation, source: HTMLButtonElement) {
    const { entry } = recommendation;
    if (!snapshot || !matchesPriorityRecommendation(entry, incidents.find(({ id }) => id === entry.incidentId),
      priorityQueueMembership(snapshot.groups), dashboard.nowMs)) return;
    navigation.jump(entry.target, {
      id: entry.incidentId,
      version: entry.incidentVersion,
      onArrival: (target) => select(target.id, target.attentionKey, target, recommendation, source),
      onUnavailable: () => focusFeed(source),
    });
  }

  const detailOpened = useCallback(() => {
    if (selection?.attentionKey) markViewed(selection.attentionKey);
    if (selection?.target) inspectTarget(selection.target);
  }, [selection, markViewed, inspectTarget]);

  function returnFocus() {
    const target = opener.current;
    opener.current = null;
    if (target?.fromFeed) focusFeed(target.node);
    else if (target?.node?.isConnected) target.node.focus({ preventScroll: true });
    else document.getElementById("incident-search")?.focus({ preventScroll: true });
  }

  function changeFilters(patch: Partial<QueueFilters>) {
    navigation.cancel(true);
    setFilters((previous) => ({ ...previous, ...patch }));
  }

  return (
    <AppShell
      title="Goida-board"
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
      {!snapshot && dashboard.connection === "connecting" ? <div className="skeleton" aria-busy="true">Загрузка очереди</div> : null}
      {!snapshot && dashboard.connection !== "connecting" ? <p className="empty-screen">Нет данных</p> : null}
      {snapshot ? (
        <>
          <DashboardMetrics queues={summary} pending={activity.pending} onJump={navigation.jump} />
          <PriorityFeed data={dashboard.priorityFeed} nowMs={dashboard.nowMs} onChoose={chooseRecommendation} />
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
            {navigation.revealed.map(({ category, id }) => (
              <p key={`${category}:${id}`} className={operationsStyles.countNote} role="status">
                Заявка {id} показана вне фильтров в очереди «{QUEUE_LABELS[category].label}».
              </p>
            ))}
            <IncidentBoard queues={navigation.queues} nowMs={dashboard.nowMs} attention={activity.queues}
              descriptions={dashboard.priorityFeed.descriptions} target={navigation.target} expandedSla={navigation.expandedSla}
              onToggleSla={navigation.toggleSla} onInspect={(category, id, attention) => {
                const target = navigation.target(category, id);
                select(id, target ? target.attentionKey : attention, target);
              }} />
          </section>
        </>
      ) : null}
      {selection ? (
        <IncidentDetails key={selection.id} id={selection.id} incident={selected}
          nowMs={dashboard.nowMs} client={dashboard.incidentClient} revision={snapshot?.revision}
          recommendation={selection.recommendation} onShown={detailOpened} assistantEscape={assistantOpen}
          onClose={() => setSelection(null)} onReturnFocus={returnFocus} />
      ) : null}
      <AssistantHost
        incident={selection ? {
          id: selection.id,
          title: selected?.title ?? selectedDetail.data?.ticket.title ?? null,
          // Live incidents and archived tickets have different version identifiers.
          version: selected?.version ?? selectedDetail.data?.ticket.version,
        } : null}
        contextReady={!selection || (selectedDetail.isSuccess && !selectedDetail.isFetching)}
        contextError={detailFailed ? detailError : null}
        retryContext={() => { void selectedDetail.refetch(); }}
        operatorToken={operatorToken}
        requestChat={dashboard.requestAssistantChat}
        onOpenChange={setAssistantOpen}
      />
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

function focusFeed(source: HTMLElement | null) {
  const target = source?.isConnected ? source : document.getElementById("priority-feed-heading");
  target?.focus();
}
