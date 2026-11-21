import { AssistantChatResponseSchema } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { createSession, initialAssistantState, reduceAssistant, sessionKeyForIncident } from "../state";

describe("assistant state", () => {
  it("opens dashboard with welcome and keeps incident sessions isolated", () => {
    const base = initialAssistantState();
    const incident = { id: "INC-1", title: "Сбой", version: "v1" };
    const opened = reduceAssistant(base, { type: "open", target: "dashboard", incident: null });
    expect(opened.phase).toBe("open");
    expect(opened.sessions.dashboard?.messages).toEqual([{ id: "welcome", kind: "welcome" }]);

    const incidentKey = sessionKeyForIncident(incident.id);
    const withIncident = reduceAssistant(opened, { type: "switch", target: incidentKey, incident });
    expect(withIncident.activeKey).toBe(incidentKey);
    expect(withIncident.sessions[incidentKey]?.messages).toEqual([]);

    const response = AssistantChatResponseSchema.parse({
      mode: "incident",
      status: "answered",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      source: "rules",
      reason: "rules_mode",
      context: { incidentId: incident.id, incidentVersion: incident.version },
      summary: "Найден 1 завершённый инцидент.",
      nextSteps: [],
      matches: [],
    });
    const answered = reduceAssistant(
      reduceAssistant(withIncident, { type: "start", requestId: 1, question: "" }),
      { type: "success", requestId: 1, response },
    );
    expect(answered.sessions[incidentKey]?.messages.at(-1)).toMatchObject({ kind: "assistant" });
    expect(createSession("dashboard", null).messages).toEqual([{ id: "welcome", kind: "welcome" }]);
  });
});