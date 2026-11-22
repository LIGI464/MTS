import type { AssistantChatResponse } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { CONTEXT_CHANGED, initialAssistantState, reduceAssistant, sessionKeyForIncident, type IncidentContext } from "../state";

const incident = { id: "INC-1", title: "Сбой печати", version: "v1" };
const target = sessionKeyForIncident(incident.id);
const question = "Что известно по этой заявке?";
const response: AssistantChatResponse = {
  mode: "incident",
  status: "answered",
  evaluatedAt: "2026-01-01T00:00:00.000Z",
  source: "llm",
  reason: null,
  context: { incidentId: incident.id, incidentVersion: incident.version },
  summary: "Очередь печати остановилась.",
  nextSteps: [],
  matches: [],
};

function open(selected: IncidentContext = incident) {
  return reduceAssistant(initialAssistantState(), { type: "open", target, incident: selected });
}

function queued(state = open(), requestId = 1) {
  return reduceAssistant(state, { type: "queue", target, requestId, question });
}

describe("assistant state", () => {
  it("starts with an empty chat and sends a manually queued question when the first version arrives", () => {
    const waiting = open({ id: incident.id, title: incident.title });
    expect(waiting.sessions[target]).toMatchObject({ messages: [], pending: null });
    const ready = reduceAssistant(queued(waiting), { type: "sync", target, incident });
    expect(ready.sessions[target]?.pending).toMatchObject({ question, phase: "queued" });
    const sending = reduceAssistant(ready, { type: "send", target, requestId: 1 });
    const answered = reduceAssistant(sending, { type: "success", target, requestId: 1, response });
    const collapsed = reduceAssistant(answered, { type: "collapse" });
    const reopened = reduceAssistant(collapsed, { type: "open", target, incident });
    expect(reopened.sessions[target]).toMatchObject({
      pending: null, draft: "", messages: [{ kind: "user", text: question }, { kind: "assistant", response }],
    });
  });

  it("discards a late response after switching to a second incident", () => {
    const sending = reduceAssistant(queued(), { type: "send", target, requestId: 1 });
    const second = { id: "INC-2", title: "Другая заявка", version: "v1" };
    const secondKey = sessionKeyForIncident(second.id);
    const switched = reduceAssistant(sending, { type: "sync", target: secondKey, incident: second });
    const waiting = reduceAssistant(switched, { type: "queue", target: secondKey, requestId: 2, question });
    expect(reduceAssistant(waiting, { type: "success", target, requestId: 1, response })).toBe(waiting);
    expect(waiting.sessions[target]).toMatchObject({ draft: question, pending: null, messages: [] });
    expect(waiting.sessions[secondKey]?.context.incidentId).toBe(second.id);
  });

  it("cancels work for an outdated version and rejects a response for the wrong version", () => {
    const sending = reduceAssistant(queued(), { type: "send", target, requestId: 1 });
    const updated = reduceAssistant(sending, { type: "sync", target, incident: { ...incident, version: "v2" } });
    expect(updated.sessions[target]).toMatchObject({
      draft: question, pending: null, context: { incidentVersion: "v2" },
    });
    expect(reduceAssistant(updated, { type: "success", target, requestId: 1, response })).toBe(updated);

    const retried = reduceAssistant(queued(updated, 2), { type: "send", target, requestId: 2 });
    const failed = reduceAssistant(retried, { type: "success", target, requestId: 2, response });
    expect(failed.sessions[target]).toMatchObject({ error: CONTEXT_CHANGED, draft: question, messages: [] });
  });

  it("retains the draft after cancellation or failure without adding an unsent message to history", () => {
    const cancelled = reduceAssistant(queued(), { type: "cancel", target });
    expect(cancelled.sessions[target]).toMatchObject({ draft: question, pending: null, messages: [] });
    const sending = reduceAssistant(queued(cancelled, 2), { type: "send", target, requestId: 2 });
    const failed = reduceAssistant(sending, { type: "failure", target, requestId: 2, message: "Токен недействителен." });
    expect(failed.sessions[target]).toMatchObject({
      draft: question, pending: null, error: "Токен недействителен.", messages: [],
    });
    const retry = queued(failed, 3);
    expect(retry.sessions[target]).toMatchObject({ error: null, pending: { requestId: 3, question } });
  });
});
