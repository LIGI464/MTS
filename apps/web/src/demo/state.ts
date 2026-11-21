export type ResetPhase = "idle" | "confirm" | "pending" | "done" | "error";

export type ResetView = {
  phase: ResetPhase;
  message: string | null;
};

export const tokenRejectedMessage = "Операторский токен не принят";
export const resetReadyMessage = "Набор восстановлен";

export type ResetEvent =
  | { type: "open" }
  | { type: "cancel" }
  | { type: "submit" }
  | { type: "success" }
  | { type: "token-rejected" }
  | { type: "failure"; message: string };

export function reduceReset(state: ResetView, event: ResetEvent): ResetView {
  if (event.type === "open") {
    return state.phase === "pending" ? state : { phase: "confirm", message: null };
  }
  if (event.type === "cancel") {
    return state.phase === "pending" ? state : { phase: "idle", message: state.message };
  }
  if (event.type === "submit") {
    return state.phase === "pending" ? state : { phase: "pending", message: null };
  }
  if (event.type === "success") return { phase: "done", message: resetReadyMessage };
  if (event.type === "token-rejected") return { phase: "error", message: tokenRejectedMessage };
  return { phase: "error", message: event.message };
}

export function isTokenError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "OPERATOR_TOKEN_INVALID" || /токен/i.test(message);
}
