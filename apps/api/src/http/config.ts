import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function dataDirectory(env: NodeJS.ProcessEnv): string {
  return resolve(REPO_ROOT, env.MTS_DATA_DIR || "data/runtime");
}

export function operatorToken(env: NodeJS.ProcessEnv): string | undefined {
  return env.MTS_OPERATOR_TOKEN?.trim() || undefined;
}

export function liveAnalysisEnabled(env: NodeJS.ProcessEnv, token: string | undefined): boolean {
  return env.MTS_AI_MODE === "live" && Boolean(env.CODEX_SALE_API_KEY?.trim() && env.CODEX_SALE_MODEL?.trim() && token);
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2_147_483_647 ? number : fallback;
}
