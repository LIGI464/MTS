import {
  API_PREFIX,
  ApiErrorSchema,
  AssignCoordinatorResultSchema,
  AssignCoordinatorSchema,
  CoordinatorListSchema,
  FullTicketDetailSchema,
  type AssignCoordinator,
  type AssignCoordinatorResult,
  type CoordinatorList,
  type FullTicketDetail,
} from "@mts/contracts";

export class TicketRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super("Не удалось выполнить запрос заявки.");
    this.name = "TicketRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function fetchTicketDetail(
  fetchImpl: typeof fetch,
  id: string,
  signal?: AbortSignal,
): Promise<FullTicketDetail> {
  const body = await request(fetchImpl, `${API_PREFIX}/itsm/incidents/${encodeURIComponent(id)}`, { signal });
  const parsed = FullTicketDetailSchema.safeParse(body);
  if (!parsed.success || parsed.data.ticket.id !== id) throw new TicketRequestError(502, "INVALID_TICKET");
  return parsed.data;
}

export async function fetchCoordinators(fetchImpl: typeof fetch, signal?: AbortSignal): Promise<CoordinatorList> {
  const body = await request(fetchImpl, `${API_PREFIX}/coordinators`, { signal });
  const parsed = CoordinatorListSchema.safeParse(body);
  if (!parsed.success) throw new TicketRequestError(502, "INVALID_DIRECTORY");
  return parsed.data;
}

export async function assignCoordinator(
  fetchImpl: typeof fetch,
  id: string,
  token: string,
  command: AssignCoordinator,
): Promise<AssignCoordinatorResult> {
  const payload = AssignCoordinatorSchema.safeParse(command);
  if (!payload.success) throw new TicketRequestError(400, "INVALID_REQUEST");
  const body = await request(fetchImpl, `${API_PREFIX}/itsm/incidents/${encodeURIComponent(id)}/coordinator`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload.data),
  });
  const parsed = AssignCoordinatorResultSchema.safeParse(body);
  if (!parsed.success || parsed.data.id !== id) throw new TicketRequestError(502, "INVALID_RESULT");
  return parsed.data;
}

async function request(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, cache: "no-store" });
  } catch {
    throw new TicketRequestError(0, "NETWORK");
  }
  const body = await readJson(response);
  if (response.ok) return body;
  const error = ApiErrorSchema.safeParse(body);
  throw new TicketRequestError(response.status, error.success ? error.data.code : undefined);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
