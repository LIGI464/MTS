import { buildPriorityFeed, describeIncident, preparePriorityFacts } from "@mts/analysis/priorities";
import {
  matchesPriorityRecommendation, priorityQueueMembership, priorityResetSequence, prioritySlaKey,
  type PriorityFeed, type Snapshot,
} from "@mts/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { DashboardRequestError, requestPriorityFeed } from "./api";

const RETRY_MS = 30_000;

export function usePriorityFeed(snapshot: Snapshot | null, nowMs: number, mock: boolean, token?: string) {
  const id = useId();
  const [access, setAccess] = useState({ token, version: 0 });
  if (access.token !== token) setAccess({ token, version: access.version + 1 });
  const mode = token ? `${id}/${access.version}` : "rules";

  const byId = useMemo(() => new Map(snapshot?.incidents.map((incident) => [incident.id, incident])), [snapshot?.incidents]);
  const revision = snapshot?.revision;
  const reset = snapshot ? priorityResetSequence(snapshot) : null;
  const sla = snapshot ? prioritySlaKey(snapshot.incidents, nowMs) : "";
  const { data, isFetching, isError } = useQuery({
    queryKey: ["priority-feed", mock, mode, revision, reset, sla],
    enabled: snapshot !== null,
    queryFn: async ({ signal }) => {
      if (!snapshot) throw new Error("Приоритеты требуют снимок пульта");
      const result = mock
        ? buildPriorityFeed(snapshot, nowMs, new Map())
        : await requestPriorityFeed(token, signal);
      const evaluatedMs = Date.parse(result.evaluatedAt);
      const groups = priorityQueueMembership(snapshot.groups);
      if (result.revision !== revision || result.resetSequence !== reset ||
          prioritySlaKey(snapshot.incidents, evaluatedMs) !== sla) {
        throw new DashboardRequestError("PRIORITIES_STALE", "Снимок изменился во время расчёта");
      }
      if (result.descriptions.length !== byId.size ||
          result.descriptions.some(({ incidentId, incidentVersion }) => byId.get(incidentId)?.version !== incidentVersion) ||
          result.recommendations.some((entry) => !matchesPriorityRecommendation(entry, byId.get(entry.incidentId), groups, evaluatedMs))) {
        throw new DashboardRequestError("INVALID_PRIORITIES", "Выдача не соответствует снимку пульта");
      }
      return result;
    },
    staleTime: Infinity,
    gcTime: 60_000,
    networkMode: "always",
    retry: (count, error) => count === 0 && !cannotRetry(error),
    refetchInterval: ({ state }) =>
      state.data?.fallback || (state.error && !cannotRetry(state.error)) ? RETRY_MS : false,
  });

  const [last, setLast] = useState<{ mode: string; result: PriorityFeed }>();
  useEffect(() => {
    if (data) setLast({ mode, result: data });
  }, [data, mode]);

  const previous = last?.mode === mode && last.result.resetSequence === reset ? last.result : undefined;
  const current = data ?? previous;
  const result = useMemo(() => {
    if (data || !snapshot || !previous) return data;
    const groups = priorityQueueMembership(snapshot.groups);
    return {
      ...previous,
      recommendations: previous.recommendations.filter((entry) =>
        matchesPriorityRecommendation(entry, byId.get(entry.incidentId), groups, nowMs)),
      descriptions: previous.descriptions.filter(({ incidentId, incidentVersion }) => byId.get(incidentId)?.version === incidentVersion),
    };
  // SLA changes capture all relevant clock transitions.
  }, [data, snapshot, previous, byId, sla]);

  const descriptions = useMemo(() => {
    const texts = new Map([...byId].map(([id, incident]) => [id, describeIncident(preparePriorityFacts(incident, null))]));
    for (const { incidentId, incidentVersion, text } of current?.descriptions ?? []) {
      if (byId.get(incidentId)?.version === incidentVersion) texts.set(incidentId, text);
    }
    return texts;
  }, [byId, current]);

  const status = isError ? "error" : isFetching ? (result ? "updating" : "loading") : result ? "ready" : "loading";
  return { result, descriptions, status };
}

function cannotRetry(error: Error): boolean {
  return error instanceof DashboardRequestError && (error.status === 403 || error.code === "PRIORITIES_STALE");
}
