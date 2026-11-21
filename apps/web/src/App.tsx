import type { Notice, Snapshot } from "@mts/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUpRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisPanel } from "./analysis";
import { IncidentBoard, itsmHref } from "./board";
import { formatMoscow, presentSla } from "./board/format";
import { useDashboard, type DemoStep } from "./data";
import { DemoControls } from "./demo";
import { ActivityFeed, DashboardMetrics, DashboardWorkspace, SoundButton } from "./operations/dashboard";
import { filterQueueGroups, summarizeQueues, type QueueFilter } from "./operations/queue-summary";
import { useIncidentAlerts } from "./operations/use-incident-alerts";
import { useIncidentSound } from "./operations/use-incident-sound";
import { AppShell } from "./shell";

const HISTORY = new Set(["Resolved", "Closed", "Research", "Other"]);

const STEPS: Array<[DemoStep, string]> = [
  ["critical", "Критический"],
  ["assign", "Назначение"],
  ["deadline", "Срок"],
  ["resolve", "Решение"],
];

export function App() {
  const dashboard = useDashboard();
  const [operatorToken, setOperatorToken] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"card" | "history">("card");
  const [filter, setFilter] = useState<QueueFilter | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const snapshot = dashboard.snapshot;
  const selected = snapshot?.incidents.find((incident) => incident.id === selectedId) ?? null;
  const selectedSla = selected ? presentSla(selected, dashboard.nowMs) : null;
  const history = useMemo(() => snapshot?.incidents.filter((incident) => HISTORY.has(incident.state)) ?? [], [snapshot]);
  const availableIds = useMemo(() => new Set(snapshot?.incidents.map(({ id }) => id)), [snapshot]);
  const summary = snapshot ? summarizeQueues(snapshot, dashboard.nowMs) : null;
  const filteredSnapshot = snapshot && summary && filter ? filterQueueGroups(snapshot, summary[filter]) : snapshot;
  const { events, alert, highlight } = useIncidentAlerts(snapshot, dashboard.newNotices);
  const sound = useIncidentSound(alert);
  const resetSeq = dashboard.newNotices.findLast((notice) => notice.kind === "demo.reset")?.seq;

  useEffect(() => {
    if (resetSeq === undefined) return;
    setSelectedId(null);
    setTab("card");
    setFilter(null);
  }, [resetSeq]);

  function inspect(id: string) {
    if (selectedId === null) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setSelectedId(id);
    setTab("card");
  }

  function closeDetails() {
    const opener = openerRef.current;
    openerRef.current = null;
    setSelectedId(null);
    queueMicrotask(() => opener?.focus());
  }

  return (
    <AppShell
      title="Пульт координатора"
      headerActions={<SoundButton {...sound} />}
      healthBadge={
        <span
          className="health-text"
          role="status"
          data-live={dashboard.connection === "live" && snapshot?.source.status === "ok"}
        >
          {badgeText(dashboard.connection, snapshot)}
        </span>
      }
      titleActions={snapshot ? (
        <a className="activity-jump" href="#incident-activity">
          События <ArrowDown size={15} aria-hidden />
        </a>
      ) : null}
      footerSlot={
        <>
          <DemoControls
            enabled={snapshot?.capabilities.demoReset ?? false}
            liveAnalysis={snapshot?.capabilities.liveAnalysis ?? false}
            operatorToken={operatorToken}
            onOperatorToken={setOperatorToken}
            onReset={dashboard.resetDemo}
          />
          {dashboard.stepMock ? (
            <div className="mock-steps">
              {STEPS.map(([step, label]) => (
                <button key={step} type="button" onClick={() => dashboard.stepMock?.(step)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      }
    >
      {snapshot?.source.status === "stale" ? (
        <p className="banner" role="status">
          Показан последний сохранённый снимок. Источник устарел.
        </p>
      ) : null}
      {snapshot?.source.status === "unavailable" ? (
        <p className="banner" role="status">
          Файл временно недоступен
        </p>
      ) : null}
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
      {!snapshot && dashboard.connection === "connecting" ? (
        <div className="skeleton" aria-busy="true">
          Загрузка очереди
        </div>
      ) : null}
      {!snapshot && dashboard.connection !== "connecting" ? <p className="empty-screen">Нет данных</p> : null}
      {filteredSnapshot && summary ? (
        <>
          <DashboardMetrics summary={summary} filter={filter} onChange={setFilter} />
          <DashboardWorkspace
            filter={filter}
            onClear={() => setFilter(null)}
            events={<ActivityFeed events={events} incidentIds={availableIds} highlight={highlight} onInspect={inspect} />}
          >
            <IncidentBoard
              snapshot={filteredSnapshot}
              nowMs={dashboard.nowMs}
              highlight={highlight}
              onInspect={inspect}
            />
          </DashboardWorkspace>
        </>
      ) : null}
      <Dialog.Root open={selected !== null} onOpenChange={(open) => { if (!open) closeDetails(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="detail" data-surface="surface">
            {selected && selectedSla ? (
              <>
                <div className="detail-heading">
                  <div>
                    <Dialog.Description className="detail-id" data-numeric="tabular">{selected.id}</Dialog.Description>
                    <Dialog.Title>{selected.title}</Dialog.Title>
                  </div>
                  <Dialog.Close className="detail-close" aria-label="Закрыть">
                    <X size={21} aria-hidden />
                  </Dialog.Close>
                </div>
                <p className="detail-sla" data-tone={selectedSla.tone} data-numeric="tabular" title={selectedSla.hint}>
                  <span>SLA</span>
                  <strong>{selectedSla.status}</strong>
                  {selectedSla.duration ? <span>{selectedSla.duration}</span> : null}
                </p>
                <div className="tabs" role="tablist" aria-label="Панель инцидента">
                  <button type="button" role="tab" aria-selected={tab === "card"} onClick={() => setTab("card")}>
                    Карточка
                  </button>
                  <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
                    История
                  </button>
                </div>
                <div role="tabpanel" hidden={tab !== "card"}>
                  <dl className="detail-fields">
                    <div><dt>Регистрация</dt><dd>{formatMoscow(selected.createdAt)}</dd></div>
                    <div><dt>Статус</dt><dd>{selected.stateLabel}</dd></div>
                    <div><dt>Исполнитель</dt><dd>{selected.assignee ?? "Исполнитель не назначен"}</dd></div>
                    <div><dt>Команда</dt><dd>{selected.team ?? "Группа не назначена"}</dd></div>
                  </dl>
                  <p className="detail-summary">{selected.summary ?? "Описание не указано"}</p>
                  <a className="detail-itsm" href={itsmHref(selected)} target="_blank" rel="noopener noreferrer">
                    В ITSM <ArrowUpRight size={16} aria-hidden />
                  </a>
                  <AnalysisPanel
                    incident={selected}
                    runAnalysis={dashboard.runAnalysis}
                    operatorToken={operatorToken}
                  />
                </div>
                <div role="tabpanel" hidden={tab !== "history"}>
                  {history.length === 0 ? (
                    <p>История пуста</p>
                  ) : (
                    <ul className="history">
                      {history.map((incident) => (
                        <li key={incident.id}>
                          <button type="button" onClick={() => inspect(incident.id)}>
                            {incident.id} · {incident.title}
                          </button>
                          <span>{incident.stateLabel}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <Dialog.Title>Инцидент</Dialog.Title>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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
  if (notice.kind === "demo.reset") return notice.title ?? "Набор восстановлен";
  return notice.title ?? "Событие";
}
