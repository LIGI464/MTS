import type { Incident } from "@mts/contracts";
import { useQueries } from "@tanstack/react-query";
import { detailQuery, type IncidentClient } from "../data/incidents";
import { filterIncidents, matchesRawFilters, needsRawFields, type QueueFilters } from "./queue-summary";

export function useFilteredIncidents(
  incidents: readonly Incident[],
  filters: QueueFilters,
  nowMs: number,
  client: IncidentClient,
  revision?: number,
) {
  const candidates = filterIncidents(incidents, filters, nowMs);
  const needsDetails = needsRawFields(filters);
  const results = useQueries({
    queries: needsDetails ? candidates.map(({ id, version }) => detailQuery(client, id, version, revision)) : [],
  });
  return {
    incidents: needsDetails ? candidates.filter((_, index) => {
      const detail = results[index].data;
      return detail ? matchesRawFilters(detail.rawFields, filters) : false;
    }) : candidates,
    loading: results.some((entry) => entry.isPending),
    failures: results.filter((entry) => entry.isError).length,
    retry: () => {
      for (const result of results) {
        if (result.isError) void result.refetch();
      }
    },
  };
}
