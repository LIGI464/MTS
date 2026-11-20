import type { Notice, Snapshot } from "@mts/contracts";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import { AnalysisPanel } from "./analysis";
import { IncidentBoard } from "./board";
import { useDashboard, type DemoStep } from "./data";
import { DemoControls } from "./demo";
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
  const [ribbon, setRibbon] = useState<Notice[]>([]);
  const openerRef = useRef<HTMLElement | null>(null);
  const snapshot = dashboard.snapshot;
  const selected = snapshot?.incidents.find((incident) => incident.id === selectedId) ?? null;
  const history = snapshot?.incidents.filter((incident) => HISTORY.has(incident.state)) ?? [];

  useEffect(() => {
    const notices = dashboard.newNotices;
    if (notices.length === 0) return;
    if (notices.some((notice) => notice.kind === "demo.reset")) {
      setRibbon(notices.filter((notice) => notice.kind === "demo.reset"));
      setSelectedId(null);
      setTab("card");
      return;
    }
    setRibbon((current) => {
      const known = new Set(current.map((notice) => notice.seq));
      const extra = notices.filter((notice) => !known.has(notice.seq));
      return extra.length === 0 ? current : [...current, ...extra];
    });
  }, [dashboard.newNotices]);

  function inspect(id: string) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      healthBadge={<span className="health-text">{badgeText(dashboard.connection, snapshot)}</span>}
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
      {ribbon.length > 0 ? (
        <section className="ribbon" aria-label="Лента событий">
          <h2>События</h2>
          <ol>
            {ribbon.map((notice) => (
              <li key={notice.seq}>{noticeLine(notice)}</li>
            ))}
          </ol>
        </section>
      ) : null}
      {dashboard.newNotices.length > 0 ? (
        <div className="toasts">
          {dashboard.newNotices.map((notice) => (
            <article key={notice.seq} className={notice.kind === "critical.resolved" ? "toast resolved" : "toast"}>
              <p>{noticeLine(notice)}</p>
              <button type="button" onClick={() => dashboard.dismissNotice(notice.seq)}>
                Закрыть
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
      {snapshot ? <IncidentBoard snapshot={snapshot} nowMs={dashboard.nowMs} onInspect={inspect} /> : null}
      <Dialog.Root open={selected !== null} onOpenChange={(open) => { if (!open) closeDetails(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="detail">
            {selected ? (
              <>
                <Dialog.Title>{selected.title}</Dialog.Title>
                <Dialog.Description className="detail-id">{selected.id}</Dialog.Description>
                <div className="tabs" role="tablist" aria-label="Панель инцидента">
                  <button type="button" role="tab" aria-selected={tab === "card"} onClick={() => setTab("card")}>
                    Карточка
                  </button>
                  <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>
                    История
                  </button>
                </div>
                <div role="tabpanel" hidden={tab !== "card"}>
                  <p>Регистрация: {moscow(selected.createdAt)}</p>
                  <p>Статус: {selected.stateLabel}</p>
                  <p>
                    Исполнитель:{" "}
                    {selected.assignee ?? (selected.team ? "Исполнитель не назначен" : "Назначение не указано")}
                  </p>
                  <p>Команда: {selected.team ?? "Группа не назначена"}</p>
                  <p>{selected.summary ?? "Описание не указано"}</p>
                  {selected.itsmUrl ? (
                    <a href={selected.itsmUrl} target="_blank" rel="noopener noreferrer">
                      В ITSM
                    </a>
                  ) : (
                    <p>Ссылка ITSM не настроена</p>
                  )}
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
                <Dialog.Close className="detail-close">Закрыть</Dialog.Close>
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

function moscow(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
