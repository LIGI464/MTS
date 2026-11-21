import type { ImportPreviewResult } from "@mts/contracts";
import { DashboardRequestError } from "../data/api";
import type { ImportIssue } from "./import-validation";

export type ValidPreview = Extract<ImportPreviewResult, { valid: true }>;

export type ImportState =
  | { phase: "idle" | "checking" }
  | { phase: "check-error" | "conflict"; message: string }
  | { phase: "invalid"; issues: readonly ImportIssue[] }
  | { phase: "review" | "applying"; preview: ValidPreview; requestId?: string; error?: string }
  | { phase: "submitted"; revision: number };

export const tokenRequired = "Введите токен оператора в разделе «Служебное».";

export function importFailure(caught: unknown, action: "preview" | "apply"): string {
  if (caught instanceof DashboardRequestError) {
    if (caught.status === 401 || caught.status === 403 || caught.code === "OPERATOR_TOKEN_INVALID") {
      return "Доступ отклонён. Проверьте токен оператора в разделе «Служебное».";
    }
    if (caught.status === 404) return "Импорт недоступен на сервере.";
    return caught.message;
  }
  if (action === "apply") {
    return "Не удалось получить ответ сервера. Проверьте соединение и повторите подтверждение.";
  }
  return "Не удалось связаться с сервером. Проверьте соединение и повторите проверку файла.";
}
