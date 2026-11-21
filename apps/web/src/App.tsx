import type { Notice, Snapshot } from "@mts/contracts";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IncidentBoard } from "./board";
import { IncidentDetails } from "./board/incident-details";
import { uniqueIncidents } from "./board/model";
import { useDashboard, type DemoStep } from "./data";
import { coordinatorQuery } from "./data/incidents";
import { DemoControls } from "./demo";
import { ActivityPanel } from "./operations/activity-panel";
import { DashboardMetrics, SoundButton } from "./operations/dashboard";
import { IncidentFilters } from "./operations/filters";
import { DEFAULT_FILTERS, summarizeQueues, type QueueFilters } from "./operations/queue-summary";
import { useFilteredIncidents } from "./operations/use-filtered-incidents";
import { useIncidentAlerts } from "./operations/use-incident-alerts";
import { useIncidentSound } from "./operations/use-incident-sound";
import operationsStyles from "./operations/dashboard.module.css";
import { AppShell } from "./shell";
import { EventsButton } from "./shell/events-button";

const STEPS: Array<[DemoStep, string]> = [
  ["critical", "Критический"], ["assign", "Назначение"], ["deadline", "Срок"], ["resolve", "Решение"],
];

export function App() {
  const dashboard = useDashboard();
  const [operatorToken, setOperatorToken] = useState<string | undefined>(undefined);
  const [selection, setSelection] = useState<{ id: string; mode: "detail" | "assignment" } | null>(null);
  const [filters, setFilters] = useState<QueueFilters>(DEFAULT_FILTERS);
  const opener = useRef<HTMLElement | null>(null);
  const snapshot = dashboard.snapshot;
  const incidents = useMemo(() => uniqueIncidents(snapshot?.incidents ?? []), [snapshot]);
  const selected = incidents.find(({ id }) => id === selection?.id);
  const directory = useQuery({ ...coordinatorQuery(dashboard.incidentClient), enabled: Boolean(snapshot) });
  const filtered = useFilteredIncidents(incidents, filters, dashboard.nowMs, dashboard.incidentClient);
  const summary = summarizeQueues(incidents, dashboard.nowMs);
  const { events, alert, highlight, unreadCount, markRead } = useIncidentAlerts(snapshot, dashboard.newNotices);
  const sound = useIncidentSound(alert);
  const resetSeq = dashboard.newNotices.findLast((notice) => notice.kind === "demo.reset")?.seq;

  useEffect(() => {
    if (resetSeq === undefined) return;
    setSelection(null);
    setFilters(DEFAULT_FILTERS);
  }, [resetSeq]);

  function select(id: string, mode: "detail" | "assignment") {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection({ id, mode });
  }

  function returnFocus() {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else document.getElementById("incident-search")?.focus({ preventScroll: true });
  }

  function changeFilters(patch: Partial<QueueFilters>) {
    setFilters((previous) => ({ ...previous, ...patch }));
  }

  return (
    <AppShell
      title="Пульт координатора"
      headerActions={
        <>
          <ActivityPanel events={events} unreadCount={unreadCount} highlight={highlight} markRead={markRead}
            onInspect={(id) => select(id, "detail")}>
            <EventsButton count={unreadCount} />
          </ActivityPanel>
          <SoundButton {...sound} />
        </>
      }
      healthBadge={
        <span className="health-text" role="status" data-live={dashboard.connection === "live" && snapshot?.source.status === "ok"}>
          {badgeText(dashboard.connection, snapshot)}
        </span>
      }
      footerSlot={
        <>
          <DemoControls enabled={snapshot?.capabilities.demoReset ?? false}
            liveAnalysis={snapshot?.capabilities.liveAnalysis ?? false} operatorToken={operatorToken}
            onOperatorToken={setOperatorToken} onReset={dashboard.resetDemo} />
          {dashboard.stepMock ? (
            <div className="mock-steps">
              {STEPS.map(([step, label]) => (
                <button key={step} type="button" onClick={() => dashboard.stepMock?.(step)}>{label}</button>
              ))}
            </div>
          ) : null}
        </>
      }
    >
      {snapshot?.source.status === "stale" ? (
        <p className="banner" role="status">Показан последний сохранённый снимок. Источник устарел.</p>
      ) : null}
      {snapshot?.source.status === "unavailable" ? <p className="banner" role="status">Файл временно недоступен</p> : null}
      <div className="sr-only" aria-live="polite">
        {highlight ? `Новые инциденты: ${[...highlight.incidentIds].join(", ")}` : ""}
      </div>
      {dashboard.newNotices.length > 0 ? (
        <div className="toasts" aria-label="Оповещения">
          {dashboard.newNotices.map((notice) => (
            <article key={notice.seq} className={notice.kind === "critical.resolved" ? "toast resolved" : "toast"}>
              <p>{noticeLine(notice)}</p>
              <button type="button" aria-label="Закрыть оповещение" onClick={() => dashboard.dismissNotice(notice.seq)}>
                <X size={16} aria-hidden />
              </button>
            </article>
          ))}
        </div>
      ) : null}
      {!snapshot && dashboard.connection === "connecting" ? <div className="skeleton" aria-busy="true">Загрузка очереди</div> : null}
      {!snapshot && dashboard.connection !== "connecting" ? <p className="empty-screen">Нет данных</p> : null}
      {snapshot ? (
        <>
          <DashboardMetrics summary={summary} filters={filters} onChange={changeFilters} />
          <IncidentFilters filters={filters} incidents={incidents} coordinators={directory.data ?? []} onChange={changeFilters} />
          <section aria-labelledby="queue-heading" aria-busy={filtered.loading}>
            <div className={operationsStyles.queueHeader}>
              <h2 id="queue-heading">Очереди инцидентов</h2>
              <p role="status" data-numeric="tabular">
                {filtered.loading ? "Проверяем поля заявок…" : `Показано ${filtered.incidents.length} из ${incidents.length}`}
              </p>
            </div>
            {filtered.failures > 0 ? (
              <p className="banner" role="alert">
                Не удалось проверить поля заявок ({filtered.failures}).{" "}
                <button type="button" onClick={filtered.retry}>Повторить</button>
              </p>
            ) : null}
            <IncidentBoard incidents={filtered.incidents} nowMs={dashboard.nowMs} highlight={highlight}
              onInspect={(id) => select(id, "detail")} onAssign={(id) => select(id, "assignment")} />
          </section>
        </>
      ) : null}
      {selection ? (
        <IncidentDetails key={selection.id} id={selection.id} mode={selection.mode} incident={selected}
          nowMs={dashboard.nowMs} client={dashboard.incidentClient} operatorToken={operatorToken}
          runAnalysis={dashboard.runAnalysis} sseRevision={dashboard.sseRevision}
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
