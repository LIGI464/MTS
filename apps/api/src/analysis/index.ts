import { performance } from "node:perf_hooks";
import { createAnalyzer, type PreparedAnalysis } from "@mts/analysis";
import { API_PREFIX, AnalysisResultSchema, type AnalysisResult, type ApiError, type Incident } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { analyzerConfig, liveAnalysisEnabled } from "../http/config.js";
import { INVALID_OPERATOR_TOKEN, isValidOperatorToken, readBearer } from "../http/operator-token.js";
import type { RouteContext } from "../runtime-contract.js";

const INCIDENT_NOT_FOUND = { code: "INCIDENT_NOT_FOUND", message: "Инцидент не найден." } satisfies ApiError;
const TOO_MANY_REQUESTS = {
  code: "TOO_MANY_REQUESTS", message: "Достигнут лимит запросов к модели. Попробуйте позже.",
} satisfies ApiError;

const CACHE_SIZE = 128;
const CACHE_MS = 10 * 60_000;
const FALLBACK_MS = 30_000;
const LIVE_WINDOW_MS = 60_000;

type CacheEntry = { result: AnalysisResult; expiresAt: number };

function validatedResult(value: unknown, incident: Incident): AnalysisResult | undefined {
  const parsed = AnalysisResultSchema.safeParse(value);
  if (parsed.success && parsed.data.incidentId === incident.id && parsed.data.incidentVersion === incident.version) {
    return parsed.data;
  }
}

export function registerAnalysisRoutes(app: FastifyInstance, context: RouteContext, makeAnalyzer = createAnalyzer): void {
  const { runtime, env, operatorToken } = context;
  const liveEnabled = liveAnalysisEnabled(env, operatorToken);
  const analyzer = makeAnalyzer(analyzerConfig(env));
  const cached = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<AnalysisResult>>();
  let generation = 0;
  let lastResetSeq = runtime.getSnapshot().notices.findLast((notice) => notice.kind === "demo.reset")?.seq ?? 0;
  let activeLive = 0;
  const liveStarts: number[] = [];

  function clear(): void {
    generation += 1;
    cached.clear();
    inFlight.clear();
  }

  const unsubscribe = runtime.subscribe((snapshot) => {
    const reset = snapshot.notices.findLast((notice) => notice.kind === "demo.reset");
    if (!reset || reset.seq <= lastResetSeq) return;
    lastResetSeq = reset.seq;
    clear();
  });
  app.addHook("onClose", async () => {
    unsubscribe();
    clear();
  });

  async function run(prepared: PreparedAnalysis, incident: Incident, useLive: boolean): Promise<AnalysisResult> {
    const began = performance.now();
    let fallback: "provider_error" | "invalid_output" = "invalid_output";
    try {
      const result = validatedResult(await analyzer.run(prepared, { useLive }), incident);
      if (result && (useLive || result.source === "rules")) {
        if (useLive && result.reason && result.reason !== "rules_mode") {
          app.log.warn({ reason: result.reason, durationMs: Math.round(performance.now() - began) }, "Резервный анализ.");
        }
        return result;
      }
    } catch {
      fallback = "provider_error";
    }

    app.log.warn({ reason: fallback, durationMs: Math.round(performance.now() - began) }, "Резервный анализ.");
    const rules = validatedResult(prepared.rules, incident);
    if (rules?.source === "rules") return { ...rules, reason: fallback };
    throw new Error("Некорректный результат анализа.");
  }

  app.post<{ Params: { id: string } }>(`${API_PREFIX}/incidents/:id/analysis`, async (request, reply) => {
    const snapshot = runtime.getSnapshot();
    const incident = snapshot.incidents.find((entry) => entry.id === request.params.id);
    if (!incident) return reply.code(404).send(INCIDENT_NOT_FOUND);

    const header = request.headers.authorization;
    const authorized = isValidOperatorToken(operatorToken, readBearer(header));
    if (header !== undefined && !authorized) return reply.code(403).send(INVALID_OPERATOR_TOKEN);

    const useLive = liveEnabled && authorized;
    const prepared = analyzer.prepare({
      incident,
      description: runtime.getDescription(incident.id),
      history: snapshot.incidents.filter(({ state }) => state === "Resolved" || state === "Closed" || state === "Research"),
      now: snapshot.serverNow,
    });
    const key = JSON.stringify([incident.id, incident.version, prepared.key, useLive]);
    const now = performance.now();
    reply.header("Cache-Control", "no-store");

    const hit = cached.get(key);
    if (hit) {
      cached.delete(key);
      if (hit.expiresAt > now) {
        cached.set(key, hit);
        return hit.result;
      }
    }
    const existing = inFlight.get(key);
    if (existing) return existing;

    if (useLive) {
      while (liveStarts.length > 0 && now - liveStarts[0] >= LIVE_WINDOW_MS) liveStarts.shift();
      if (activeLive >= 2 || liveStarts.length >= 8) return reply.code(429).send(TOO_MANY_REQUESTS);
      activeLive += 1;
      liveStarts.push(now);
    }

    const startedGeneration = generation;
    const work = run(prepared, incident, useLive).then((result) => {
      if (startedGeneration === generation) {
        const fallback = result.reason !== null && result.reason !== "rules_mode";
        cached.set(key, { result, expiresAt: performance.now() + (fallback ? FALLBACK_MS : CACHE_MS) });
        if (cached.size > CACHE_SIZE) {
          const oldest = cached.keys().next();
          if (!oldest.done) cached.delete(oldest.value);
        }
      }
      return result;
    }).finally(() => {
      if (useLive) activeLive -= 1;
      if (inFlight.get(key) === work) inFlight.delete(key);
    });
    inFlight.set(key, work);
    return work;
  });
}
