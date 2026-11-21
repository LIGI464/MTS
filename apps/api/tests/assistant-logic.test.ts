import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSISTANT_PROMPT_VERSION, createAssistantResponder } from "@mts/analysis";
import { API_PREFIX, AssistantChatResponseSchema } from "@mts/contracts";
import { expect, it, vi } from "vitest";
import { registerAssistantRoutes } from "../src/assistant/index.ts";
import { atomicWrite } from "../src/source/file.ts";
import { createDashboardRuntime } from "../src/source/index.ts";
import { LIVE_FILENAME } from "../src/source/input.ts";
import Fastify from "fastify";

const TOKEN = "logic-operator";

it("scans every unique archive ticket and caps completed matches after full ranking", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mts-assistant-logic-"));
  const livePath = join(dataDir, LIVE_FILENAME);
  const options = { dataDir, pollMs: 15, capabilities: { demoReset: false, liveAnalysis: false } };
  const subject = {
    id: "SYN-LOGIC/subject", priorityId: 3, stateEnum: "Assigned",
    header: "Сбой печати этикеток", description: "Очередь печати зависла",
    productName: "Склад", service: "Печать", submitDate: "2026-05-15T09:30:00.000Z",
  };
  const weak = Array.from({ length: 7 }, (_, index) => ({
    ...subject,
    id: `SYN-LOGIC/weak/${index}`,
    stateEnum: "Closed",
    header: "Общий заголовок",
    description: "Не связанный симптом",
  }));
  const activeHit = {
    ...subject, id: "SYN-LOGIC/active", stateEnum: "WorkInProgress",
    header: "Зависает печать этикеток", description: "Очередь печати ждёт перезапуска",
  };
  const archiveHit = {
    ...subject, id: "SYN-LOGIC/archive", stateEnum: "Resolved",
    solution: "Перезапустили службу.", completionDate: "2026-05-16T10:00:00.000Z",
  };
  let runtime: Awaited<ReturnType<typeof createDashboardRuntime>> | undefined;
  try {
    await atomicWrite(livePath, Buffer.from(JSON.stringify([subject, ...weak, activeHit, archiveHit])));
    runtime = await createDashboardRuntime(options);
    await vi.waitFor(() => {
      expect(runtime!.getSnapshot().incidents.some(({ id }) => id === subject.id)).toBe(true);
    }, { timeout: 3_000, interval: 20 });

    const result = runtime.findSimilarIncidents({ incidentId: subject.id });
    expect(result.kind).toBe("found");
    if (result.kind !== "found") throw new Error("expected matches");
    expect(result.matches[0]?.id).toBe(archiveHit.id);
    expect(result.coverage.uniqueExamined).toBe(9);
    expect(result.coverage.complete).toBe(true);
    expect(result.activeSimilar.some(({ id }) => id === activeHit.id)).toBe(true);
  } finally {
    await runtime?.close();
    await rm(dataDir, { force: true, recursive: true });
  }
});

it("carries conversation history and coverage in prepared facts", () => {
  const responder = createAssistantResponder({
    baseUrl: "https://example.invalid/v1",
    timeoutMs: 1_000,
  });
  const prepared = responder.prepare({
    mode: "dashboard",
    question: "Что просрочено?",
    history: [{ role: "user", text: "Подскажи по пульту" }],
    context: {},
    incident: null,
    description: null,
    searchStatus: "answered",
    matches: [],
    activeSimilar: [],
    coverage: {
      revision: 3,
      uniqueAvailable: 10,
      uniqueExamined: 10,
      complete: true,
      sources: [{ name: "character_problems.json", ok: true }],
    },
    compareWith: null,
    compareDescription: null,
    compareNotFound: null,
    dashboardFacts: { overdueCount: 2, nearCount: 0, overdueIds: ["INC1", "INC2"], nearIds: [] },
    useComparisonPrompt: false,
    now: "2026-05-15T12:00:00.000Z",
  });
  expect(prepared.caseFacts.history).toHaveLength(1);
  expect(prepared.caseFacts.coverage).toMatchObject({ uniqueExamined: 10, revision: 3 });
  expect(prepared.useComparisonPrompt).toBe(false);
});

it("answers due date in rules mode without completed analogs", () => {
  const responder = createAssistantResponder({
    baseUrl: "https://example.invalid/v1",
    timeoutMs: 1_000,
  });
  const prepared = responder.prepare({
    mode: "incident",
    question: "Когда срок?",
    history: [],
    context: { incidentId: "SYN-LOGIC/subject" },
    incident: {
      id: "SYN-LOGIC/subject",
      version: "v1",
      title: "Сбой",
      product: "Склад",
      service: "Печать",
      team: null,
      assignee: null,
      state: "Assigned",
      stateLabel: "Назначен",
      priority: 2,
      createdAt: "2026-05-15T09:00:00.000Z",
      dueAt: "2026-05-15T18:00:00.000Z",
      resolvedAt: null,
      present: true,
      hasSolution: false,
      coordinator: null,
      urgency: null,
      impact: null,
      summary: null,
      itsmUrl: null,
    },
    description: "Очередь печати",
    searchStatus: "no_matches",
    matches: [],
    activeSimilar: [],
    coverage: { revision: 1, uniqueAvailable: 3, uniqueExamined: 3, complete: true, sources: [] },
    compareWith: null,
    compareDescription: null,
    compareNotFound: null,
    dashboardFacts: null,
    useComparisonPrompt: true,
    now: "2026-05-15T12:00:00.000Z",
  });
  expect(prepared.rules.summary).toMatch(/Срок по заявке/);
});

it("reports unknown compare target through the HTTP route", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mts-assistant-compare-"));
  let runtime: Awaited<ReturnType<typeof createDashboardRuntime>> | undefined;
  let app: Awaited<ReturnType<typeof Fastify>> | undefined;
  try {
    await atomicWrite(join(dataDir, LIVE_FILENAME), Buffer.from(JSON.stringify([{
      id: "SYN-LOGIC/a", priorityId: 3, stateEnum: "Assigned", header: "A", submitDate: "2026-05-15T09:30:00.000Z",
    }])));
    runtime = await createDashboardRuntime({ dataDir, pollMs: 20, capabilities: { demoReset: false, liveAnalysis: false } });
    await vi.waitFor(() => {
      expect(runtime!.getSnapshot().incidents.length).toBeGreaterThan(0);
    }, { timeout: 3_000, interval: 20 });
    app = Fastify({ logger: false });
    registerAssistantRoutes(app, {
      runtime,
      dataDir,
      operatorToken: TOKEN,
      env: { MTS_AI_MODE: "rules", MTS_OPERATOR_TOKEN: TOKEN },
    });
    await app.ready();
    const response = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        mode: "incident",
        question: "Сравни с SYN-LOGIC/missing",
        context: { incidentId: "SYN-LOGIC/a" },
      },
    });
    const body = AssistantChatResponseSchema.parse(response.json());
    expect(body.status).toBe("incident_not_found");
    expect(body.summary).toContain("SYN-LOGIC/missing");
  } finally {
    await app?.close();
    await runtime?.close();
    await rm(dataDir, { force: true, recursive: true });
  }
});

it("pins prompt version in the responder cache key material", () => {
  expect(ASSISTANT_PROMPT_VERSION).toMatch(/^mts-assistant-logic-/u);
});