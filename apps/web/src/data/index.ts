import {
  AnalysisResultSchema,
  SnapshotSchema,
  makeMockTimeline,
  type AnalysisResult,
  type Notice,
  type Snapshot,
} from "@mts/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

export type DemoStep = "critical" | "assign" | "deadline" | "resolve";

export function useDashboard(): {
  snapshot: Snapshot | null;
  nowMs: number;
  connection: "connecting" | "live" | "reconnecting" | "mock";
  newNotices: Notice[];
  dismissNotice: (seq: number) => void;
  runAnalysis: (id: string, token?: string) => Promise<AnalysisResult>;
  resetDemo: (token: string) => Promise<Snapshot>;
  stepMock?: (step: DemoStep) => void;
} {
  const mockMode = import.meta.env.VITE_DATA_MODE === "mock";
  const startedRef = useRef<number | null>(null);
  if (startedRef.current === null) startedRef.current = Date.now();
  const timeline = useMemo(() => {
    const next = makeMockTimeline(startedRef.current ?? Date.now());
    SnapshotSchema.parse(next.initial);
    for (const frame of Object.values(next.frames)) SnapshotSchema.parse(frame);
    return next;
  }, []);
  const [step, setStep] = useState<DemoStep | null>(null);
  const [resetSnapshot, setResetSnapshot] = useState<Snapshot | null>(null);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const snapshot = mockMode ? (resetSnapshot ?? (step ? timeline.frames[step] : timeline.initial)) : null;
  const snapshotRef = useRef<Snapshot | null>(snapshot);
  snapshotRef.current = snapshot;
  const watermarkRef = useRef<number | null>(null);
  if (snapshot && watermarkRef.current === null) {
    watermarkRef.current = snapshot.notices.reduce((max, notice) => Math.max(max, notice.seq), 0);
  }

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const newNotices = snapshot
    ? snapshot.notices.filter(
        (notice) =>
          (watermarkRef.current === null || notice.seq > watermarkRef.current) && !dismissed.includes(notice.seq),
      )
    : [];

  function dismissNotice(seq: number) {
    setDismissed((current) => (current.includes(seq) ? current : [...current, seq]));
  }

  async function runAnalysis(id: string, _token?: string): Promise<AnalysisResult> {
    const incident = snapshotRef.current?.incidents.find((item) => item.id === id);
    if (!incident) throw new Error("Инцидент не найден");
    return AnalysisResultSchema.parse({
      incidentId: incident.id,
      incidentVersion: incident.version,
      evaluatedAt: new Date().toISOString(),
      source: "rules",
      summary: incident.summary ?? incident.title,
      recommendedTeam: null,
      risk: { level: "low", factors: ["По полям выгрузки повышающих факторов не видно"] },
      reason: "rules_mode",
    });
  }

  async function resetDemo(token: string): Promise<Snapshot> {
    if (!mockMode) throw new Error("Сброс недоступен");
    if (token.trim().length === 0) throw new Error("Нужен операторский токен");
    const current = snapshotRef.current;
    const next = SnapshotSchema.parse({
      ...structuredClone(timeline.initial),
      revision: (current?.revision ?? 0) + 1,
      serverNow: new Date().toISOString(),
      notices: [
        {
          seq: Math.max(0, ...(current?.notices.map((notice) => notice.seq) ?? [0])) + 1,
          kind: "demo.reset",
          incidentId: null,
          title: "Набор восстановлен",
          at: new Date().toISOString(),
        },
      ],
    });
    setStep(null);
    setDismissed([]);
    setResetSnapshot(next);
    return next;
  }

  function stepMock(next: DemoStep) {
    setResetSnapshot(null);
    setStep(next);
  }

  const state = {
    snapshot,
    nowMs,
    connection: mockMode ? ("mock" as const) : ("connecting" as const),
    newNotices,
    dismissNotice,
    runAnalysis,
    resetDemo,
  };
  return mockMode ? { ...state, stepMock } : state;
}
