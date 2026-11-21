import {
  API_PREFIX,
  ApiErrorSchema,
  ImportApplyRequestSchema,
  ImportApplyResultSchema,
  ImportPreviewRequestSchema,
  ImportPreviewResultSchema,
  type ImportApplyRequest,
  type ImportPreviewRequest,
} from "@mts/contracts";
import { DashboardRequestError, errorFromBody } from "./api";

const base = `${API_PREFIX}/incidents/import`;

export async function fetchImportAvailability(signal: AbortSignal): Promise<boolean> {
  // D24 checks authorization before parsing the body. This probe can never create a preview.
  const response = await fetch(`${base}/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    credentials: "omit",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (response.status === 404) return false;
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (response.status === 403 && body.success && body.data.code === "OPERATOR_TOKEN_INVALID") return true;
  throw new DashboardRequestError("IMPORT_AVAILABILITY_UNKNOWN", "Не удалось проверить доступность импорта", response.status);
}

export async function requestImportPreview(body: ImportPreviewRequest, token: string, signal: AbortSignal) {
  const payload = await importRequest("preview", ImportPreviewRequestSchema.parse(body), token, signal);
  const result = ImportPreviewResultSchema.safeParse(payload);
  if (!result.success) throw new DashboardRequestError("INVALID_RESPONSE", "Не удалось прочитать результат проверки файла.");
  return result.data;
}

export async function requestImportApply(body: ImportApplyRequest, token: string) {
  const payload = await importRequest("apply", ImportApplyRequestSchema.parse(body), token);
  const result = ImportApplyResultSchema.safeParse(payload);
  if (!result.success) throw new DashboardRequestError("INVALID_RESPONSE", "Не удалось прочитать подтверждение импорта.");
  return result.data;
}

async function importRequest(
  action: "preview" | "apply",
  body: ImportPreviewRequest | ImportApplyRequest,
  token: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers = new Headers({ "content-type": "application/json" });
  try {
    headers.set("authorization", `Bearer ${token}`);
  } catch {
    throw new DashboardRequestError("OPERATOR_TOKEN_INVALID", "Токен оператора некорректен.");
  }
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(`${base}/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw errorFromBody(payload, "Запрос импорта завершился ошибкой.", response.status);
  return payload;
}
