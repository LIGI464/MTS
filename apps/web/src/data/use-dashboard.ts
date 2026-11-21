import {
  API_PREFIX,
  AnalysisResultSchema,
  SnapshotSchema,
  type AnalysisResult,
  type Notice,
  type Snapshot,
} from "@mts/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyFrame, createClientFrameState, dismissFrameNotice, type ClientFrameState } from "./apply";
import { fetchDashboard, requestAnalysis, requestReset } from "./api";
import { createIncidentFixtures } from "./incident-fixtures";
import { incidentApi, type IncidentClient } from "./incidents";

export type DemoStep = "critical" | "assign" | "deadline" | "resolve";

type Connection = "connecting" | "live" | "reconnecting" | "mock";

export function useDashboard(): {
  snapshot: Snapshot | null;
  nowMs: number;
  sseRevision: number | null;
  incidentClient: IncidentClient;
  connection: Connection;
  newNotices: Notice[];
  dismissNotice: (seq: number) => void;
  runAnalysis: (id: string, token?: string) => Promise<AnalysisResult>;
  resetDemo: (token: string) => Promise<Snapshot>;
  stepMock?: (step: DemoStep) => void;
} {
  const mockMode = import.meta.env.VITE_DATA_MODE === "mock";
  const [boot] = useState(() => createBoot(mockMode));
  const [frame, setFrame] = useState<ClientFrameState>(boot.frame);
  const frameRef = useRef(frame);
  const offsetRef = useRef(Date.now() - performance.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sseRevision, setSseRevision] = useState<number | null>(null);
  const [connection, setConnection] = useState<Connection>(mockMode ? "mock" : "connecting");

  const accept = useCallback((incoming: Snapshot, origin: "get" | "sse" | "reset") => {
    const current = frameRef.current;
    const next = applyFrame(current, incoming, origin);
    if (origin === "sse" && (!current.snapshot || incoming.revision >= current.snapshot.revision)) {
      setSseRevision((previous) => Math.max(previous ?? 0, incoming.revision));
    }
    if (next === current) return;
    frameRef.current = next;
    setFrame(next);
    const parsed = Date.parse(incoming.serverNow);
    if (!Number.isNaN(parsed)) {
      offsetRef.current = parsed - performance.now();
      setNowMs(performance.now() + offsetRef.current);
    }
    if (!mockMode) setConnection("live");
  }, [mockMode]);

  const incidentClient = boot.fixtures?.client ?? incidentApi;

  const query = useQuery({
    queryKey: ["dashboard"],
    enabled: !mockMode,
    queryFn: fetchDashboard,
    retry: 1,
  });

  useEffect(() => {
    if (!query.data) return;
    accept(query.data, "get");
  }, [query.data, accept]);

  useEffect(() => {
    if (!query.isError || mockMode) return;
    setConnection("reconnecting");
  }, [query.isError, mockMode]);

  useEffect(() => {
    if (mockMode) return;
    const source = new EventSource(`${API_PREFIX}/events`);
    const onDashboard = (event: Event) => {
      if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
        setConnection("reconnecting");
        return;
      }
      try {
        accept(SnapshotSchema.parse(JSON.parse(event.data)), "sse");
      } catch {
        setConnection("reconnecting");
      }
    };
    const onError = () => setConnection("reconnecting");
    source.addEventListener("dashboard", onDashboard);
    source.onerror = onError;
    return () => {
      source.removeEventListener("dashboard", onDashboard);
      source.onerror = null;
      source.close();
    };
  }, [mockMode, accept]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(performance.now() + offsetRef.current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const dismissNotice = useCallback((seq: number) => {
    const next = dismissFrameNotice(frameRef.current, seq);
    frameRef.current = next;
    setFrame(next);
  }, []);

  async function runAnalysis(id: string, token?: string): Promise<AnalysisResult> {
    if (!mockMode) return requestAnalysis(id, token);
    const incident = frameRef.current.snapshot?.incidents.find((item) => item.id === id);
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
    if (token.trim().length === 0) throw new Error("Нужен операторский токен");
    if (!boot.fixtures) return requestReset(token);
    const next = boot.fixtures.reset(Date.now());
    accept(next, "reset");
    return next;
  }

  function stepMock(step: DemoStep) {
    if (boot.fixtures) accept(boot.fixtures.step(step, Date.now()), "sse");
  }

  const value = {
    snapshot: frame.snapshot,
    nowMs,
    sseRevision,
    incidentClient,
    connection,
    newNotices: frame.visible,
    dismissNotice,
    runAnalysis,
    resetDemo,
  };
  return mockMode ? { ...value, stepMock } : value;
}

function createBoot(mockMode: boolean) {
  const fixtures = mockMode ? createIncidentFixtures(Date.now()) : null;
  const frame = createClientFrameState();
  return { fixtures, frame: fixtures ? applyFrame(frame, fixtures.initial, "get") : frame };
}
