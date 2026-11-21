import {
  API_PREFIX,
  AnalysisResultSchema,
  SnapshotSchema,
  makeMockTimeline,
  type AnalysisResult,
  type Notice,
  type Snapshot,
} from "@mts/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyFrame, createClientFrameState, dismissFrameNotice, type ClientFrameState } from "./apply";
import { fetchDashboard, requestAnalysis, requestReset } from "./api";

export type DemoStep = "critical" | "assign" | "deadline" | "resolve";

type Connection = "connecting" | "live" | "reconnecting" | "mock";

export function useDashboard(): {
  snapshot: Snapshot | null;
  nowMs: number;
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
  frameRef.current = frame;
  const offsetRef = useRef(Date.now() - performance.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [connection, setConnection] = useState<Connection>(mockMode ? "mock" : "connecting");

  const accept = useCallback((incoming: Snapshot, origin: "get" | "sse" | "reset") => {
    const current = frameRef.current;
    const next = applyFrame(current, incoming, origin);
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
    if (!mockMode || !boot.timeline) return requestReset(token);
    const current = frameRef.current.snapshot;
    const maxSeq = Math.max(0, ...(current?.notices.map((notice) => notice.seq) ?? [0]), ...frameRef.current.seen);
    const next = SnapshotSchema.parse({
      ...structuredClone(boot.timeline.initial),
      revision: (current?.revision ?? boot.timeline.initial.revision) + 1,
      serverNow: new Date().toISOString(),
      notices: [
        {
          seq: maxSeq + 1,
          kind: "demo.reset",
          incidentId: null,
          title: "Набор восстановлен",
          at: new Date().toISOString(),
        },
      ],
    });
    accept(next, "reset");
    return next;
  }

  function stepMock(step: DemoStep) {
    if (!boot.timeline) return;
    accept(boot.timeline.frames[step], "sse");
  }

  const value = {
    snapshot: frame.snapshot,
    nowMs,
    connection,
    newNotices: frame.visible,
    dismissNotice,
    runAnalysis,
    resetDemo,
  };
  return mockMode ? { ...value, stepMock } : value;
}

function createBoot(mockMode: boolean): {
  timeline: ReturnType<typeof makeMockTimeline> | null;
  frame: ClientFrameState;
} {
  if (!mockMode) return { timeline: null, frame: createClientFrameState() };
  const timeline = makeMockTimeline(Date.now());
  SnapshotSchema.parse(timeline.initial);
  for (const frame of Object.values(timeline.frames)) SnapshotSchema.parse(frame);
  return {
    timeline,
    frame: applyFrame(createClientFrameState(), timeline.initial, "get"),
  };
}
