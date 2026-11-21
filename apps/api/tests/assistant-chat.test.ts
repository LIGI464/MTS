import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantChatResponseSchema, API_PREFIX } from "@mts/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/index.ts";
import { atomicWrite } from "../src/source/file.ts";
import { createDashboardRuntime } from "../src/source/index.ts";
import { LIVE_FILENAME } from "../src/source/input.ts";

describe("Assistant chat HTTP", () => {
  let dataDir: string;
  let runtime: Awaited<ReturnType<typeof createDashboardRuntime>> | undefined;
  let app: ReturnType<typeof buildApp> | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "mts-assistant-chat-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    await runtime?.close();
    await rm(dataDir, { force: true, recursive: true });
    app = undefined;
    runtime = undefined;
  });

  async function boot(rows: unknown[]) {
    await atomicWrite(join(dataDir, LIVE_FILENAME), Buffer.from(JSON.stringify(rows)));
    runtime = await createDashboardRuntime({
      dataDir,
      pollMs: 10,
      itsmTemplate: "https://itsm.example/incidents/{id}?sysId={sysId}",
      capabilities: { demoReset: true, liveAnalysis: false },
    });
    app = buildApp({ runtime, dataDir, env: {} });
  }

  async function chat(body: unknown) {
    if (!app) throw new Error("app is missing");
    return app.inject({
      method: "POST",
      url: `${API_PREFIX}/assistant/chat`,
      payload: body,
    });
  }

  it("returns matches for incident mode and keeps analysis route working", async () => {
    const subject = {
      id: "SYN-D70/subject",
      priorityId: 3,
      stateEnum: "Assigned",
      header: "Зависает печать этикеток",
      description: "Очередь печати ждёт перезапуска",
      productName: "Складской учёт",
      service: "Печать",
      submitDate: "2026-05-15T09:30:00.000Z",
    };
    const archived = {
      ...subject,
      id: "SYN-D70/archive/01",
      sysId: "00098765432112345678",
      stateEnum: "Resolved",
      completionDate: "2026-05-15T10:00:00.000Z",
      shortDescription: "Зависание очереди печати этикеток",
      solution: "Перезапустили службу печати.",
    };
    const closed = { ...subject, id: "SYN-D70/closed", stateEnum: "Closed", solution: "Очередь восстановили." };

    await boot([subject, archived, closed]);
    const assistant = await chat({
      mode: "incident",
      question: "",
      context: { incidentId: subject.id },
    });
    expect(assistant.statusCode).toBe(200);
    const body = AssistantChatResponseSchema.parse(assistant.json());
    expect(body.status).toBe("answered");
    expect(body.matches.map(({ id }) => id)).toEqual([archived.id, closed.id]);
    expect(body.matches[0]).toMatchObject({
      href: `https://itsm.example/incidents/${encodeURIComponent(archived.id)}?sysId=${archived.sysId}`,
      symptom: archived.shortDescription,
      solution: archived.solution,
    });

    const analysis = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/incidents/${encodeURIComponent(subject.id)}/analysis`,
    });
    expect(analysis.statusCode).toBe(200);
  });

  it("returns needs_context for dashboard without input, answers known ID in chat, and isolates symptom search", async () => {
    const subject = {
      id: "SYN-D70/dashboard",
      priorityId: 3,
      stateEnum: "Assigned",
      header: "Печать этикеток зависает",
      description: "Очередь печати ждёт перезапуска",
      productName: "Складской учёт",
      service: "Печать",
      submitDate: "2026-05-15T09:30:00.000Z",
    };
    const archived = {
      ...subject,
      id: "SYN-D70/archive-dashboard",
      stateEnum: "Resolved",
      shortDescription: "Зависание очереди печати",
      solution: "Перезапуск службы.",
    };

    await boot([subject, archived]);

    const empty = AssistantChatResponseSchema.parse((await chat({ mode: "dashboard" })).json());
    expect(empty.status).toBe("needs_context");
    expect(empty.summary).toContain("ID");

    const byId = AssistantChatResponseSchema.parse((await chat({
      mode: "dashboard",
      question: `Проверь ${subject.id}`,
    })).json());
    expect(byId.status).toBe("answered");
    expect(byId.context.incidentId).toBe(subject.id);
    expect(byId.matches.map(({ id }) => id)).toEqual([archived.id]);

    const noMatches = AssistantChatResponseSchema.parse((await chat({
      mode: "dashboard",
      question: "Не заряжается аккумулятор.",
    })).json());
    expect(noMatches.status).toBe("no_matches");
    expect(noMatches.matches).toEqual([]);
  });

  it("returns incident_not_found for unknown IDs", async () => {
    const subject = {
      id: "SYN-D70/known",
      priorityId: 3,
      stateEnum: "Assigned",
      header: "Известная заявка",
      submitDate: "2026-05-15T09:30:00.000Z",
    };
    await boot([subject]);

    const fromIncidentMode = AssistantChatResponseSchema.parse((await chat({
      mode: "incident",
      context: { incidentId: "SYN-D70/missing" },
    })).json());
    expect(fromIncidentMode.status).toBe("incident_not_found");

    const fromDashboard = AssistantChatResponseSchema.parse((await chat({
      mode: "dashboard",
      question: "SYN-D70/missing печать",
    })).json());
    expect(fromDashboard.status).toBe("incident_not_found");
  });
});