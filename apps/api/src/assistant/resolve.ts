import type { AssistantChatContext, AssistantChatMode, AssistantChatRequest, Incident } from "@mts/contracts";
import type { DashboardRuntime } from "../runtime-contract.js";
import type { SimilarIncidentsQuery, SimilarIncidentsResult } from "./matches.js";

const ID_PATTERN = /(?:INC\d{6,}|[\p{L}\p{N}][\w/-]{2,})/giu;

function looksLikeIncidentId(value: string): boolean {
  return /^INC\d{6,}$/iu.test(value)
    || /^[A-Z]{2,}[\w-]*\/[\w/-]+$/u.test(value)
    || /^[\w-]+\/[\w/-]+$/.test(value);
}

export type ResolvedAssistantQuery = {
  query: SimilarIncidentsQuery | null;
  context: AssistantChatContext;
  incident: Incident | null;
  description: string | null;
  searchStatus: "answered" | "needs_context" | "no_matches" | "incident_not_found";
  search: SimilarIncidentsResult | null;
};

function knownTicketId(runtime: DashboardRuntime, id: string): boolean {
  return runtime.getTicket(id) !== null
    || runtime.getSnapshot().incidents.some((entry) => entry.id === id);
}

function ticketVersion(runtime: DashboardRuntime, id: string): string | undefined {
  const snapshot = runtime.getSnapshot().incidents.find((entry) => entry.id === id);
  if (snapshot) return snapshot.version;
  return runtime.getTicket(id)?.ticket.version;
}

function extractIncidentId(runtime: DashboardRuntime, text: string): string | null {
  const candidates = [...new Set(text.match(ID_PATTERN) ?? [])].sort((left, right) => right.length - left.length);
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed && knownTicketId(runtime, trimmed)) return trimmed;
  }
  return null;
}

function declaredIncidentId(text: string): string | null {
  const candidates = [...new Set(text.match(ID_PATTERN) ?? [])].sort((left, right) => right.length - left.length);
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed && looksLikeIncidentId(trimmed)) return trimmed;
  }
  return null;
}

function loadIncident(runtime: DashboardRuntime, id: string): Incident | null {
  const snapshot = runtime.getSnapshot().incidents.find((entry) => entry.id === id);
  if (snapshot) return snapshot;
  const detail = runtime.getTicket(id);
  if (!detail) return null;
  return {
    ...detail.ticket,
    urgency: null,
    impact: null,
    summary: null,
    itsmUrl: null,
  };
}

function mergeSymptoms(previous: string | undefined, question: string): string {
  return [previous, question].map((value) => value?.trim()).filter(Boolean).join(" ").trim();
}

export function resolveAssistantQuery(runtime: DashboardRuntime, request: AssistantChatRequest): ResolvedAssistantQuery {
  const question = request.question.trim();
  const mode: AssistantChatMode = request.mode;
  const incoming = request.context ?? {};

  if (mode === "incident") {
    const incidentId = incoming.incidentId?.trim();
    if (!incidentId || !knownTicketId(runtime, incidentId)) {
      return {
        query: null,
        context: { incidentId },
        incident: null,
        description: null,
        searchStatus: "incident_not_found",
        search: { kind: "incident_not_found" },
      };
    }

    const incident = loadIncident(runtime, incidentId);
    const version = ticketVersion(runtime, incidentId);
    const context: AssistantChatContext = {
      incidentId,
      incidentVersion: version,
      symptoms: mergeSymptoms(incoming.symptoms, question) || undefined,
    };
    const query: SimilarIncidentsQuery = {
      incidentId,
      symptoms: question || incoming.symptoms || undefined,
    };
    const search = runtime.findSimilarIncidents(query);
    return finalize(runtime, mode, context, incident, query, search);
  }

  const explicitId = incoming.incidentId?.trim()
    || (question ? extractIncidentId(runtime, question) : null);
  if (explicitId) {
    if (!knownTicketId(runtime, explicitId)) {
      return {
        query: null,
        context: { incidentId: explicitId },
        incident: null,
        description: null,
        searchStatus: "incident_not_found",
        search: { kind: "incident_not_found" },
      };
    }

    const strippedQuestion = question.replace(explicitId, " ").replace(/\s+/g, " ").trim();
    const incident = loadIncident(runtime, explicitId);
    const context: AssistantChatContext = {
      incidentId: explicitId,
      incidentVersion: ticketVersion(runtime, explicitId),
      symptoms: strippedQuestion || incoming.symptoms || undefined,
    };
    const query: SimilarIncidentsQuery = {
      incidentId: explicitId,
      symptoms: strippedQuestion || incoming.symptoms || undefined,
    };
    const search = runtime.findSimilarIncidents(query);
    return finalize(runtime, mode, context, incident, query, search);
  }

  const declared = question ? declaredIncidentId(question) : null;
  if (declared && !knownTicketId(runtime, declared)) {
    return {
      query: null,
      context: { incidentId: declared },
      incident: null,
      description: null,
      searchStatus: "incident_not_found",
      search: { kind: "incident_not_found" },
    };
  }

  const symptoms = mergeSymptoms(incoming.symptoms, question);
  const context: AssistantChatContext = { symptoms: symptoms || undefined };
  if (!symptoms) {
    return {
      query: null,
      context,
      incident: null,
      description: null,
      searchStatus: "needs_context",
      search: { kind: "needs_context" },
    };
  }

  const query: SimilarIncidentsQuery = { symptoms };
  const search = runtime.findSimilarIncidents(query);
  return finalize(runtime, mode, context, null, query, search);
}

function finalize(
  runtime: DashboardRuntime,
  mode: AssistantChatMode,
  context: AssistantChatContext,
  incident: Incident | null,
  query: SimilarIncidentsQuery,
  search: SimilarIncidentsResult,
): ResolvedAssistantQuery {
  const description = context.incidentId ? runtime.getDescription(context.incidentId) : null;
  if (search.kind === "incident_not_found") {
    return { query, context, incident, description, searchStatus: "incident_not_found", search };
  }
  if (search.kind === "needs_context") {
    return { query, context, incident, description, searchStatus: "needs_context", search };
  }
  if (search.kind === "no_matches") {
    return { query, context, incident, description, searchStatus: "no_matches", search };
  }
  return {
    query,
    context,
    incident,
    description,
    searchStatus: "answered",
    search,
  };
}