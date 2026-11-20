import { useState } from "react";
import { AnalysisPanel } from "./analysis";
import { IncidentBoard } from "./board";
import { useDashboard } from "./data";
import { DemoControls } from "./demo";
import { AppShell } from "./shell";

export function App() {
  const dashboard = useDashboard();
  const [operatorToken, setOperatorToken] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = dashboard.snapshot?.incidents.find((incident) => incident.id === selectedId) ?? null;
  const badge =
    dashboard.connection === "mock"
      ? "Демонстрационные данные"
      : dashboard.connection === "reconnecting"
        ? "Переподключение"
        : dashboard.connection === "live"
          ? "Данные актуальны"
          : "Данные загружаются";

  return (
    <AppShell
      healthBadge={<span>{badge}</span>}
      footerSlot={
        <DemoControls
          enabled={dashboard.snapshot?.capabilities.demoReset ?? false}
          liveAnalysis={dashboard.snapshot?.capabilities.liveAnalysis ?? false}
          operatorToken={operatorToken}
          onOperatorToken={setOperatorToken}
          onReset={dashboard.resetDemo}
        />
      }
    >
      <h1>Пульт координатора</h1>
      {dashboard.snapshot ? (
        <IncidentBoard snapshot={dashboard.snapshot} nowMs={dashboard.nowMs} onInspect={setSelectedId} />
      ) : (
        <p>Нет данных</p>
      )}
      {selected ? (
        <AnalysisPanel incident={selected} runAnalysis={dashboard.runAnalysis} operatorToken={operatorToken} />
      ) : null}
    </AppShell>
  );
}
