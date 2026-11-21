import { createAssistantResponder } from "@mts/analysis";
import { AssistantChatResponseSchema, makeMockTimeline } from "@mts/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const now = "2026-01-15T09:00:00.000Z";
const [incident] = makeMockTimeline(Date.parse(now)).initial.incidents;
if (!incident) throw new Error("mock incident is missing");

const config = { baseUrl: "https://codex.sale/v1", timeoutMs: 1000 };
const responder = createAssistantResponder(config);

const match = {
  id: "INC-PAST",
  version: "past-1",
  title: "Зависание печати",
  state: "Resolved" as const,
  resolvedAt: "2026-01-14T09:00:00.000Z",
  present: true,
  symptom: "Очередь зависла",
  solution: "Перезапустили службу печати.",
  reason: "Совпадают признаки сбоя.",
  href: "/itsm/incidents/INC-PAST",
};

afterEach(() => vi.unstubAllGlobals());

describe("assistant rules response", () => {
  it("builds needs_context, no_matches and answered replies locally", async () => {
    const needsContext = await responder.run(responder.prepare({
      mode: "dashboard",
      question: "",
      context: {},
      incident: null,
      description: null,
      searchStatus: "needs_context",
      matches: [],
      now,
    }), { useLive: false });

    const noMatches = await responder.run(responder.prepare({
      mode: "incident",
      question: "",
      context: { incidentId: incident.id, incidentVersion: incident.version },
      incident,
      description: "HTTP 503 на авторизации",
      searchStatus: "no_matches",
      matches: [],
      now,
    }), { useLive: false });

    const answered = await responder.run(responder.prepare({
      mode: "incident",
      question: "Есть ли похожие случаи?",
      context: { incidentId: incident.id, incidentVersion: incident.version },
      incident,
      description: "HTTP 503 на авторизации",
      searchStatus: "answered",
      matches: [match],
      now,
    }), { useLive: false });

    expect(AssistantChatResponseSchema.parse(needsContext)).toMatchObject({
      status: "needs_context",
      source: "rules",
      matches: [],
    });
    expect(AssistantChatResponseSchema.parse(noMatches)).toMatchObject({
      status: "no_matches",
      summary: expect.stringContaining(incident.id),
    });
    expect(AssistantChatResponseSchema.parse(answered)).toMatchObject({
      status: "answered",
      matches: [match],
      summary: expect.stringContaining("1"),
    });
  });
});