import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantResponder } from "@mts/analysis";
import {
  API_PREFIX, AssistantChatRequestSchema, AssistantChatResponseSchema,
  ImportApplyRequestSchema, ImportPreviewRequestSchema, ImportPreviewResultSchema,
} from "@mts/contracts";
import { expect, it, vi } from "vitest";
import { registerAnalysisRoutes } from "../src/analysis/index.ts";
import { registerAssistantRoutes } from "../src/assistant/index.ts";
import { atomicWrite } from "../src/source/file.ts";
import { createDashboardRuntime } from "../src/source/index.ts";
import { LIVE_FILENAME } from "../src/source/input.ts";
import Fastify from "fastify";

const TOKEN = "d90-operator";

function rows() {
  const base = {
    priorityId: 3,
    productName: "Складской учёт",
    service: "Печать",
    submitDate: "2026-05-15T09:30:00.000Z",
  };
  const subject = {
    ...base, id: "SYN-D90/subject", stateEnum: "Assigned", header: "Зависает печать этикеток",
    description: "Очередь печати ждёт перезапуска",
  };
  return [
    subject,
    {
      ...base, id: "SYN-D90/archive-01", sysId: "90001", stateEnum: "Resolved",
      header: "Зависает печать этикеток", shortDescription: "Зависание очереди печати",
      solution: "Перезапустили службу печати.", completionDate: "2026-05-15T10:00:00.000Z",
    },
    { ...base, id: "SYN-D90/archive-02", stateEnum: "Closed", header: "Сбой печати", solution: "Очистили очередь." },
    { ...base, id: "SYN-D90/other", stateEnum: "Closed", header: "Отчёт по тарифам", description: null },
    { ...base, id: "SYN-D90/research", stateEnum: "Research", header: "Зависает печать", solution: "не должно попасть" },
    { ...base, id: "SYN-D90/active", stateEnum: "WorkInProgress", header: "Зависает печать", solution: "не должно попасть" },
  ];
}

it("D90 archive import keeps removed completed IDs searchable with stable ordering", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mts-d90-"));
  const livePath = join(dataDir, LIVE_FILENAME);
  const options = {
    dataDir, pollMs: 20, itsmTemplate: "https://itsm.example/{id}",
    capabilities: { demoReset: true, liveAnalysis: false },
  };
  let runtime: Awaited<ReturnType<typeof createDashboardRuntime>> | undefined;
  try {
    await atomicWrite(livePath, Buffer.from(JSON.stringify(rows())));
    runtime = await createDashboardRuntime(options);
    await vi.waitFor(() => {
      expect(runtime!.getSnapshot().incidents.some(({ id }) => id === "SYN-D90/subject")).toBe(true);
    }, { timeout: 4_000, interval: 40 });
    const subject = "SYN-D90/subject";
    const archived = "SYN-D90/archive-01";
    const first = runtime.findSimilarIncidents({ incidentId: subject });
    expect(first.kind).toBe("found");
    if (first.kind !== "found") throw new Error("expected matches");
    expect(first.matches.map(({ id }) => id)).toEqual([archived]);
    expect(first.matches[0]).toMatchObject({
      solution: "Перезапустили службу печати.",
      href: expect.stringContaining(encodeURIComponent(archived)),
    });

    const withoutArchived = rows().filter((row) => row.id !== archived);
    await atomicWrite(livePath, Buffer.from(JSON.stringify(withoutArchived)));
    await vi.waitFor(() => {
      const next = runtime!.findSimilarIncidents({ incidentId: subject });
      expect(next.kind).toBe("found");
      if (next.kind !== "found") throw new Error("expected matches");
      expect(next.matches.map(({ id }) => id)).toEqual([archived]);
      expect(next.matches.find(({ id }) => id === archived)).toMatchObject({
        present: false, solution: "Перезапустили службу печати.",
      });
    }, { timeout: 4_000, interval: 40 });

    const second = runtime.findSimilarIncidents({ incidentId: subject });
    const third = runtime.findSimilarIncidents({ incidentId: subject });
    expect(third).toEqual(second);
  } finally {
    await runtime?.close();
    await rm(dataDir, { force: true, recursive: true });
  }
});

it("D90 assistant API contract and rules-only provider fallback", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mts-d90-api-"));
  const options = {
    dataDir, pollMs: 20, capabilities: { demoReset: false, liveAnalysis: false },
  };
  let runtime: Awaited<ReturnType<typeof createDashboardRuntime>> | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  try {
    await atomicWrite(join(dataDir, LIVE_FILENAME), Buffer.from(JSON.stringify(rows())));
    runtime = await createDashboardRuntime(options);
    await vi.waitFor(() => {
      expect(runtime!.getSnapshot().incidents.some(({ id }) => id === "SYN-D90/subject")).toBe(true);
    }, { timeout: 4_000, interval: 40 });
    const failingResponder: AssistantResponder = {
      prepare: (input) => {
        const rules = AssistantChatResponseSchema.parse({
          mode: input.mode,
          status: input.searchStatus,
          evaluatedAt: input.now,
          source: "rules",
          reason: "rules_mode",
          context: input.context,
          summary: "Локальный ответ",
          nextSteps: [],
          matches: input.matches,
        });
        return { key: "rules", rules, caseFacts: {}, allowedMatchIds: [] };
      },
      run: async () => { throw new Error("provider down"); },
    };
    const env = {
      ...process.env,
      MTS_AI_MODE: "live",
      CODEX_SALE_API_KEY: "test-key",
      CODEX_SALE_MODEL: "test-model",
    };
    app = Fastify();
    const context = { runtime, dataDir, operatorToken: TOKEN, env };
    registerAssistantRoutes(app, context, () => failingResponder);
    registerAnalysisRoutes(app, context);

    const invalid = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      payload: { mode: "unknown" },
    });
    expect(invalid.statusCode).toBe(400);

    const needsContext = AssistantChatResponseSchema.parse((await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      payload: AssistantChatRequestSchema.parse({ mode: "dashboard" }),
    })).json());
    expect(needsContext.status).toBe("needs_context");

    const answered = AssistantChatResponseSchema.parse((await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      payload: { mode: "incident", context: { incidentId: "SYN-D90/subject" } },
    })).json());
    expect(answered.status).toBe("answered");
    expect(answered.matches.length).toBeGreaterThan(0);

    const notFound = AssistantChatResponseSchema.parse((await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      payload: { mode: "dashboard", question: "SYN-D90/missing" },
    })).json());
    expect(notFound.status).toBe("incident_not_found");

    const unauthorized = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      headers: { authorization: "Bearer wrong" },
      payload: { mode: "dashboard", question: "печать этикеток" },
    });
    expect(unauthorized.statusCode).toBe(403);

    const live = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { mode: "incident", context: { incidentId: "SYN-D90/subject" } },
    });
    const fallback = AssistantChatResponseSchema.parse(live.json());
    expect(fallback.source).toBe("rules");
    expect(fallback.reason).toBe("provider_error");
    expect(fallback.matches.map(({ id }) => id)).toEqual(answered.matches.map(({ id }) => id));

    const beforeLive = await readFile(join(dataDir, LIVE_FILENAME));
    const analysis = await app.inject({ method: "POST", url: `${API_PREFIX}/incidents/SYN-D90%2Fsubject/analysis` });
    expect(analysis.statusCode).toBe(200);
    expect(await readFile(join(dataDir, LIVE_FILENAME))).toBe(beforeLive);
  } finally {
    await app?.close();
    await runtime?.close();
    await rm(dataDir, { force: true, recursive: true });
  }
});

it("D90 import preview does not mutate tickets beyond accepted revision", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mts-d90-import-"));
  const livePath = join(dataDir, LIVE_FILENAME);
  const seed = rows();
  const app = Fastify();
  let runtime: Awaited<ReturnType<typeof createDashboardRuntime>> | undefined;
  try {
    await atomicWrite(livePath, Buffer.from(JSON.stringify(seed)));
    runtime = await createDashboardRuntime({ dataDir, pollMs: 20, capabilities: { demoReset: false, liveAnalysis: false } });
    const { registerImportRoutes } = await import("../src/http/import.js");
    registerImportRoutes(app, { runtime, dataDir, operatorToken: TOKEN, env: process.env });
    const previewBody = ImportPreviewRequestSchema.parse({
      fileName: "d90.json",
      jsonText: JSON.stringify(seed.filter((row) => row.id !== "SYN-D90/archive-01")),
    });
    const preview = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/incidents/import/preview`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: previewBody,
    });
    expect(preview.statusCode).toBe(200);
    const parsed = ImportPreviewResultSchema.parse(preview.json());
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    const applyBody = ImportApplyRequestSchema.parse({
      previewId: parsed.previewId,
      expectedRevision: parsed.expectedRevision,
      requestId: "00000000-0000-4000-8000-000000000001",
    });
    const applied = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/incidents/import/apply`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: applyBody,
    });
    expect(applied.statusCode).toBe(200);
    const archived = runtime.findSimilarIncidents({ incidentId: "SYN-D90/subject" });
    expect(archived.kind).toBe("found");
    if (archived.kind === "found") {
      expect(archived.matches.some(({ id }) => id === "SYN-D90/archive-01")).toBe(true);
    }
  } finally {
    await app.close();
    await runtime?.close();
    await rm(dataDir, { force: true, recursive: true });
  }
});

async function readFile(path: string) {
  const { readFile: read } = await import("node:fs/promises");
  return read(path, "utf8");
}