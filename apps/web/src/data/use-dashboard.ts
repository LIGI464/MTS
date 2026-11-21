import {
  API_PREFIX,
  AnalysisResultSchema,
  AssistantChatResponseSchema,
  SnapshotSchema,
  type AnalysisResult,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type Snapshot,
} from "@mts/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyFrame, createClientFrameState, type ClientFrameState } from "./apply";
import { fetchDashboard, requestAnalysis, requestAssistantChat, requestReset } from "./api";
import { createIncidentFixtures } from "./incident-fixtures";
import { incidentApi, type IncidentClient } from "./incidents";
import { usePriorityFeed } from "./use-priority-feed";

export type DemoStep = "critical" | "assign" | "deadline" | "resolve";

type Connection = "connecting" | "live" | "reconnecting" | "mock";

export function useDashboard(operatorToken?: string): {
  snapshot: Snapshot | null;
  nowMs: number;
  priorityFeed: ReturnType<typeof usePriorityFeed>;
  sseRevision: number | null;
  incidentClient: IncidentClient;
  connection: Connection;
  runAnalysis: (id: string, token?: string) => Promise<AnalysisResult>;
  requestAssistantChat: (payload: AssistantChatRequest, token?: string) => Promise<AssistantChatResponse>;
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

  async function requestAssistant(
    payload: AssistantChatRequest,
    token?: string,
  ): Promise<AssistantChatResponse> {
    if (!mockMode) return requestAssistantChat(payload, token);
    const now = new Date().toISOString();
    const incident = payload.context.incidentId
      ? frameRef.current.snapshot?.incidents.find((item) => item.id === payload.context.incidentId)
      : undefined;
    const question = payload.question.trim();
    if (payload.mode === "dashboard" && !question && !payload.context.symptoms) {
      return AssistantChatResponseSchema.parse({
        mode: "dashboard",
        status: "needs_context",
        evaluatedAt: now,
        source: "rules",
        reason: "rules_mode",
        context: payload.context,
        summary: "Укажите ID инцидента или опишите симптомы.",
        nextSteps: ["Введите номер инцидента или опишите симптомы в одном сообщении."],
        matches: [],
      });
    }
    return AssistantChatResponseSchema.parse({
      mode: payload.mode,
      status: incident || question ? "answered" : "no_matches",
      evaluatedAt: now,
      source: "rules",
      reason: "rules_mode",
      context: payload.context,
      summary: incident
        ? `Для ${incident.id} найден один завершённый пример в демонстрационных данных.`
        : "Подходящих завершённых инцидентов не найдено.",
      nextSteps: ["Проверьте шаги из карточки аналога."],
      matches: incident ? [{
        id: "INC-HISTORY",
        version: "mock",
        title: "Устранённая неисправность",
        state: "Resolved",
        resolvedAt: "2026-05-21T06:00:00.000Z",
        present: true,
        symptom: "Похожий симптом",
        solution: "Повторили действия из прошлого случая.",
        reason: "Совпадают признаки сбоя.",
        href: "/itsm/incidents/INC-HISTORY",
      }] : [],
    });
  }

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

  const priorityFeed = usePriorityFeed(frame.snapshot, nowMs, mockMode, operatorToken);

  const value = {
    snapshot: frame.snapshot,
    nowMs,
    sseRevision,
    priorityFeed,
    incidentClient,
    connection,
    runAnalysis,
    requestAssistantChat: requestAssistant,
    resetDemo,
  };
  return mockMode ? { ...value, stepMock } : value;
}

function createBoot(mockMode: boolean) {
  const fixtures = mockMode ? createIncidentFixtures(Date.now()) : null;
  const frame = createClientFrameState();
  return { fixtures, frame: fixtures ? applyFrame(frame, fixtures.initial, "get") : frame };
}
