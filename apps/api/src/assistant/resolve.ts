import {
  getSlaState,
  type AssistantChatContext,
  type AssistantChatMode,
  type AssistantChatRequest,
  type Incident,
  type Snapshot,
} from "@mts/contracts";
import type { DashboardRuntime } from "../runtime-contract.js";
import type {
  ActiveSimilarIncident,
  ComparisonCoverage,
  SimilarIncidentsQuery,
  SimilarIncidentsResult,
} from "./matches.js";
import { listDataSources, type DataSourceStatus } from "./sources.js";

const ID_PATTERN = /(?:INC\d{6,}|[\p{L}\p{N}][\w/-]{2,})/giu;

export type AssistantCoverage = ComparisonCoverage & {
  revision: number;
  sources: readonly DataSourceStatus[];
};

export type DashboardAssistantFacts = {
  overdueCount: number;
  nearCount: number;
  overdueIds: readonly string[];
  nearIds: readonly string[];
};

export type ResolvedAssistantQuery = {
  query: SimilarIncidentsQuery | null;
  context: AssistantChatContext;
  incident: Incident | null;
  description: string | null;
  searchStatus: "answered" | "needs_context" | "no_matches" | "incident_not_found";
  search: SimilarIncidentsResult | null;
  coverage: AssistantCoverage | null;
  activeSimilar: readonly ActiveSimilarIncident[];
  compareWith: Incident | null;
  compareDescription: string | null;
  compareNotFound: string | null;
  dashboardFacts: DashboardAssistantFacts | null;
  useComparisonPrompt: boolean;
};

function looksLikeIncidentId(value: string): boolean {
  return /^INC\d{6,}$/iu.test(value)
    || /^[A-Z]{2,}[\w-]*\/[\w/-]+$/u.test(value)
    || /^[\w-]+\/[\w/-]+$/.test(value);
}

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

function wantsComparison(question: string): boolean {
  return /сравн|похож|аналог|повтор|совпад/i.test(question);
}

function extractCompareTarget(runtime: DashboardRuntime, question: string, primaryId: string | undefined): string | null {
  if (!wantsComparison(question)) return null;
  const candidates = [...new Set(question.match(ID_PATTERN) ?? [])].sort((left, right) => right.length - left.length);
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed || trimmed === primaryId) continue;
    if (knownTicketId(runtime, trimmed)) return trimmed;
    if (looksLikeIncidentId(trimmed)) return trimmed;
  }
  return null;
}

function buildCoverage(
  search: SimilarIncidentsResult | null,
  revision: number,
  sources: readonly DataSourceStatus[],
): AssistantCoverage | null {
  if (!search) return null;
  if (search.kind === "found" || search.kind === "no_matches") {
    return {
      revision,
      sources,
      ...search.coverage,
    };
  }
  return null;
}

function buildDashboardFacts(snapshot: Snapshot, nowMs: number): DashboardAssistantFacts | null {
  const overdueIds: string[] = [];
  const nearIds: string[] = [];
  for (const incident of snapshot.incidents) {
    const sla = getSlaState(incident, nowMs);
    if (sla === "overdue") overdueIds.push(incident.id);
    if (sla === "near") nearIds.push(incident.id);
  }
  if (overdueIds.length === 0 && nearIds.length === 0) return { overdueCount: 0, nearCount: 0, overdueIds, nearIds };
  return {
    overdueCount: overdueIds.length,
    nearCount: nearIds.length,
    overdueIds,
    nearIds,
  };
}

function attachCompare(
  runtime: DashboardRuntime,
  question: string,
  primaryId: string | undefined,
): Pick<ResolvedAssistantQuery, "compareWith" | "compareDescription" | "compareNotFound"> {
  const target = extractCompareTarget(runtime, question, primaryId);
  if (!target) {
    return { compareWith: null, compareDescription: null, compareNotFound: null };
  }
  if (!knownTicketId(runtime, target)) {
    return { compareWith: null, compareDescription: null, compareNotFound: target };
  }
  return {
    compareWith: loadIncident(runtime, target),
    compareDescription: runtime.getDescription(target),
    compareNotFound: null,
  };
}

export function resolveAssistantQuery(
  runtime: DashboardRuntime,
  request: AssistantChatRequest,
  meta: { dataDir: string; revision: number; snapshot: Snapshot },
): ResolvedAssistantQuery {
  const question = request.question.trim();
  const mode: AssistantChatMode = request.mode;
  const incoming = request.context ?? {};
  const sources = listDataSources(meta.dataDir, meta.snapshot);
  const nowMs = Date.parse(meta.snapshot.serverNow);
  const dashboardFacts = mode === "dashboard" ? buildDashboardFacts(meta.snapshot, nowMs) : null;

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
        coverage: null,
        activeSimilar: [],
        compareWith: null,
        compareDescription: null,
        compareNotFound: null,
        dashboardFacts: null,
        useComparisonPrompt: false,
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
    const compare = attachCompare(runtime, question, incidentId);
    if (compare.compareNotFound) {
      return {
        query,
        context,
        incident,
        description: runtime.getDescription(incidentId),
        searchStatus: "incident_not_found",
        search,
        coverage: buildCoverage(search, meta.revision, sources),
        activeSimilar: search.kind === "found" || search.kind === "no_matches" ? search.activeSimilar : [],
        ...compare,
        dashboardFacts: null,
        useComparisonPrompt: true,
      };
    }
  return finalize(runtime, mode, context, incident, query, search, meta, sources, compare, dashboardFacts);
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
        coverage: null,
        activeSimilar: [],
        compareWith: null,
        compareDescription: null,
        compareNotFound: null,
        dashboardFacts,
        useComparisonPrompt: false,
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
    const compare = attachCompare(runtime, question, explicitId);
    if (compare.compareNotFound) {
      return {
        query,
        context,
        incident,
        description: runtime.getDescription(explicitId),
        searchStatus: "incident_not_found",
        search,
        coverage: buildCoverage(search, meta.revision, sources),
        activeSimilar: search.kind === "found" || search.kind === "no_matches" ? search.activeSimilar : [],
        ...compare,
        dashboardFacts,
        useComparisonPrompt: true,
      };
    }
    return finalize(runtime, mode, context, incident, query, search, meta, sources, compare, dashboardFacts);
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
      coverage: null,
      activeSimilar: [],
      compareWith: null,
      compareDescription: null,
      compareNotFound: null,
      dashboardFacts,
      useComparisonPrompt: false,
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
      coverage: null,
      activeSimilar: [],
      compareWith: null,
      compareDescription: null,
      compareNotFound: null,
      dashboardFacts,
      useComparisonPrompt: false,
    };
  }

  const query: SimilarIncidentsQuery = { symptoms };
  const search = runtime.findSimilarIncidents(query);
  const compare = attachCompare(runtime, question, undefined);
  if (compare.compareNotFound) {
    return {
      query,
      context,
      incident: null,
      description: null,
      searchStatus: "incident_not_found",
      search,
      coverage: buildCoverage(search, meta.revision, sources),
      activeSimilar: search.kind === "found" || search.kind === "no_matches" ? search.activeSimilar : [],
      ...compare,
      dashboardFacts,
      useComparisonPrompt: true,
    };
  }
  return finalize(runtime, mode, context, null, query, search, meta, sources, compare, dashboardFacts);
}

function finalize(
  runtime: DashboardRuntime,
  mode: AssistantChatMode,
  context: AssistantChatContext,
  incident: Incident | null,
  query: SimilarIncidentsQuery,
  search: SimilarIncidentsResult,
  meta: { revision: number },
  sources: readonly DataSourceStatus[],
  compare: Pick<ResolvedAssistantQuery, "compareWith" | "compareDescription" | "compareNotFound">,
  dashboardFacts: DashboardAssistantFacts | null,
): ResolvedAssistantQuery {
  const description = context.incidentId ? runtime.getDescription(context.incidentId) : null;
  const coverage = buildCoverage(search, meta.revision, sources);
  const activeSimilar = search.kind === "found" || search.kind === "no_matches" ? search.activeSimilar : [];
  const useComparisonPrompt = Boolean(
    compare.compareWith || wantsComparison(context.symptoms ?? "") || query.incidentId || query.symptoms,
  );

  if (search.kind === "incident_not_found") {
    return {
      query, context, incident, description, searchStatus: "incident_not_found", search,
      coverage, activeSimilar, ...compare, dashboardFacts, useComparisonPrompt,
    };
  }
  if (search.kind === "needs_context") {
    return {
      query, context, incident, description, searchStatus: "needs_context", search,
      coverage, activeSimilar, ...compare, dashboardFacts, useComparisonPrompt: false,
    };
  }
  if (search.kind === "no_matches") {
    return {
      query, context, incident, description, searchStatus: "no_matches", search,
      coverage, activeSimilar, ...compare, dashboardFacts, useComparisonPrompt,
    };
  }
  return {
    query, context, incident, description, searchStatus: "answered", search,
    coverage, activeSimilar, ...compare, dashboardFacts, useComparisonPrompt,
  };
}