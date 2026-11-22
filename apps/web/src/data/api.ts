import {
  API_PREFIX,
  AnalysisResultSchema,
  ApiErrorSchema,
  AssistantChatRequestSchema,
  AssistantChatResponseSchema,
  PriorityFeedSchema,
  SnapshotSchema,
  type AnalysisResult,
  type AssistantChatRequest,
  type AssistantChatResponse,
  type PriorityFeed,
  type Snapshot,
} from "@mts/contracts";

export class DashboardRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string, readonly status?: number) {
    super(message);
    this.name = "DashboardRequestError";
    this.code = code;
  }
}

export function errorFromBody(body: unknown, fallback: string, status?: number): DashboardRequestError {
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) return new DashboardRequestError(parsed.data.code, parsed.data.message, status);
  return new DashboardRequestError("REQUEST_FAILED", fallback, status);
}

export async function fetchDashboard(): Promise<Snapshot> {
  const response = await fetch(`${API_PREFIX}/dashboard`);
  if (!response.ok) throw errorFromBody(await readJson(response), "Не удалось загрузить снимок");
  const parsed = SnapshotSchema.safeParse(await response.json());
  if (!parsed.success) throw new DashboardRequestError("INVALID_SNAPSHOT", "Снимок не прошёл проверку");
  return parsed.data;
}

export async function requestAssistantChat(
  payload: AssistantChatRequest,
  token?: string,
  signal?: AbortSignal,
): Promise<AssistantChatResponse> {
  const parsedRequest = AssistantChatRequestSchema.parse(payload);
  const headers = new Headers({ "content-type": "application/json" });
  const operator = token?.trim();
  if (operator) {
    try {
      headers.set("authorization", `Bearer ${operator}`);
    } catch {
      throw new DashboardRequestError("OPERATOR_TOKEN_INVALID", "Требуется действующий токен оператора.", 403);
    }
  }
  const response = await fetch(`${API_PREFIX}/assistant/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(parsedRequest),
    signal,
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new DashboardRequestError("ASSISTANT_UNREACHABLE", "Не удалось связаться с помощником.");
  });
  if (!response.ok) throw errorFromBody(await readJson(response), "Не удалось получить ответ помощника", response.status);
  const parsed = AssistantChatResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new DashboardRequestError("INVALID_ASSISTANT", "Ответ помощника не прошёл проверку");
  return parsed.data;
}

export async function requestAnalysis(id: string, token?: string): Promise<AnalysisResult> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_PREFIX}/incidents/${encodeURIComponent(id)}/analysis`, {
    method: "POST",
    headers,
  });
  if (!response.ok) throw errorFromBody(await readJson(response), "Не удалось выполнить анализ");
  const parsed = AnalysisResultSchema.safeParse(await response.json());
  if (!parsed.success) throw new DashboardRequestError("INVALID_ANALYSIS", "Ответ анализа не прошёл проверку");
  return parsed.data;
}

export async function requestPriorityFeed(token: string | undefined, signal: AbortSignal): Promise<PriorityFeed> {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_PREFIX}/incidents/priorities`, {
    method: "POST",
    headers,
    signal,
  });
  if (!response.ok) throw errorFromBody(await readJson(response), "Не удалось загрузить приоритеты", response.status);
  const parsed = PriorityFeedSchema.safeParse(await response.json());
  if (!parsed.success) throw new DashboardRequestError("INVALID_PRIORITIES", "Ответ с приоритетами не прошёл проверку");
  return parsed.data;
}

export async function requestReset(token: string): Promise<Snapshot> {
  const response = await fetch(`${API_PREFIX}/demo/reset`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw errorFromBody(await readJson(response), "Не удалось сбросить набор");
  const parsed = SnapshotSchema.safeParse(await response.json());
  if (!parsed.success) throw new DashboardRequestError("INVALID_SNAPSHOT", "Снимок не прошёл проверку");
  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
