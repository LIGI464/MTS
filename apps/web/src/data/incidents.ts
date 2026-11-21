import {
  API_PREFIX, AssignCoordinatorResultSchema, AssignCoordinatorSchema, CoordinatorListSchema, FullTicketDetailSchema,
  type AssignCoordinator, type AssignCoordinatorResult, type CoordinatorList, type FullTicketDetail, type Incident,
} from "@mts/contracts";
import { queryOptions } from "@tanstack/react-query";
import { DashboardRequestError, errorFromBody } from "./api";

export type IncidentClient = {
  detail: (id: string, signal?: AbortSignal) => Promise<FullTicketDetail>;
  coordinators: (signal?: AbortSignal) => Promise<CoordinatorList>;
  assign: (id: string, body: AssignCoordinator, token?: string) => Promise<AssignCoordinatorResult>;
  mock?: boolean;
};

const ticketPath = (id: string) => `${API_PREFIX}/itsm/incidents/${encodeURIComponent(id)}`;

export const incidentApi: IncidentClient = {
  async detail(id, signal) {
    const result = FullTicketDetailSchema.safeParse(await incidentRequest(ticketPath(id), { signal }));
    if (!result.success || result.data.ticket.id !== id) return invalidResponse();
    return result.data;
  },
  async coordinators(signal) {
    const result = CoordinatorListSchema.safeParse(await incidentRequest(`${API_PREFIX}/coordinators`, { signal }));
    if (!result.success) return invalidResponse();
    return result.data;
  },
  async assign(id, body, token) {
    const headers = new Headers({ "content-type": "application/json" });
    if (token?.trim()) headers.set("authorization", `Bearer ${token.trim()}`);
    const result = AssignCoordinatorResultSchema.safeParse(await incidentRequest(`${ticketPath(id)}/coordinator`, {
      method: "POST",
      headers,
      body: JSON.stringify(AssignCoordinatorSchema.parse(body)),
    }));
    if (!result.success || result.data.id !== id) return invalidResponse();
    return result.data;
  },
};

async function incidentRequest(path: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  throw errorFromBody(body, "Не удалось выполнить запрос к реестру ITSM", response.status);
}

function invalidResponse(): never {
  throw new DashboardRequestError("INVALID_INCIDENT_RESPONSE", "Ответ реестра ITSM не прошёл проверку");
}

export function detailQuery(client: IncidentClient, id: string, version?: Incident["version"], revision?: number) {
  return queryOptions({
    queryKey: ["incident-detail", id, version, revision],
    queryFn: ({ signal }) => client.detail(id, signal),
    staleTime: Infinity,
    retry: false,
  });
}

export function coordinatorQuery(client: IncidentClient) {
  return queryOptions({
    queryKey: ["incident-coordinators"],
    queryFn: ({ signal }) => client.coordinators(signal),
    staleTime: 60_000,
    retry: false,
  });
}
