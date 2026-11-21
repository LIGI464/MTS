import { API_PREFIX, ApiErrorSchema, IncidentSchema, type HistoryEntry, type MutationResult, type ResolveIncident, type TicketDetail, type TicketList, type TicketSummary } from "@mts/contracts";

export const registryPath = "/itsm/incidents";
export const ticketPath = (id: string) => `${registryPath}/${encodeURIComponent(id)}`;

const summary = IncidentSchema.pick({
  id: true, version: true, title: true, product: true, service: true, team: true, assignee: true, coordinator: true,
  state: true, stateLabel: true, priority: true, createdAt: true, dueAt: true, resolvedAt: true,
}).loose();
const historyFields = summary.pick({ version: true, stateLabel: true, team: true, coordinator: true, dueAt: true, priority: true });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSummary(value: unknown): value is TicketSummary {
  return isObject(value) && typeof value.present === "boolean"
    && (value.hasSolution === undefined || typeof value.hasSolution === "boolean") && summary.safeParse(value).success;
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  return isObject(value) && typeof value.present === "boolean" && historyFields.safeParse(value).success
    && typeof value.at === "string" && Number.isFinite(Date.parse(value.at))
    && isText(value.description) && isText(value.solution);
}

export class ItsmRequestError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super("Не удалось выполнить запрос к ITSM.");
  }
}

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${API_PREFIX}${path}`, { ...options, cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;

  const error = ApiErrorSchema.safeParse(body);
  throw new ItsmRequestError(response.status, error.success ? error.data.code : undefined);
}

export async function fetchRegistry(signal?: AbortSignal): Promise<TicketList> {
  const body = await request(registryPath, { signal });
  if (!isObject(body) || !Array.isArray(body.items) || !body.items.every(isSummary)) throw new ItsmRequestError(502);
  return { items: body.items };
}

export async function fetchTicket(id: string, signal?: AbortSignal): Promise<TicketDetail> {
  const body = await request(ticketPath(id), { signal });
  if (!isObject(body) || !isSummary(body.ticket) || body.ticket.id !== id
    || !isText(body.description) || !isText(body.solution)
    || !Array.isArray(body.history) || !body.history.every(isHistoryEntry)) throw new ItsmRequestError(502);
  return { ticket: body.ticket, description: body.description, solution: body.solution, history: body.history };
}

export async function resolveTicket(id: string, operatorToken: string, intent: ResolveIncident): Promise<MutationResult> {
  const body = await request(`${ticketPath(id)}/resolve`, {
    method: "POST",
    headers: { authorization: `Bearer ${operatorToken}`, "content-type": "application/json" },
    body: JSON.stringify(intent),
  });
  if (!isObject(body) || body.id !== id || typeof body.version !== "string" || body.version.length === 0
    || typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0) {
    throw new ItsmRequestError(502);
  }
  return { id, version: body.version, revision: body.revision };
}
