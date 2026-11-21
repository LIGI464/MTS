import { performance } from "node:perf_hooks";
import { createAssistantResponder, type AssistantResponder } from "@mts/analysis";
import {
  API_PREFIX,
  AssistantChatRequestSchema,
  AssistantChatResponseSchema,
  AssistantSimilarIncidentSchema,
  type ApiError,
  type AssistantChatResponse,
} from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { liveAnalysisEnabled, positiveInteger } from "../http/config.js";
import { INVALID_OPERATOR_TOKEN, isValidOperatorToken, readBearer } from "../http/operator-token.js";
import type { RouteContext } from "../runtime-contract.js";
import { resolveAssistantQuery } from "./resolve.js";

const TOO_MANY_REQUESTS = {
  code: "TOO_MANY_REQUESTS",
  message: "Достигнут лимит запросов к модели. Попробуйте позже.",
} satisfies ApiError;

const INVALID_REQUEST = {
  code: "INVALID_REQUEST",
  message: "Некорректный запрос к помощнику.",
} satisfies ApiError;

const CACHE_SIZE = 128;
const CACHE_MS = 10 * 60_000;
const FALLBACK_MS = 30_000;
const LIVE_WINDOW_MS = 60_000;

type CacheEntry = { result: AssistantChatResponse; expiresAt: number };

function toMatches(search: ReturnType<typeof resolveAssistantQuery>["search"]): AssistantChatResponse["matches"] {
  if (!search || search.kind !== "found") return [];
  return search.matches.map((match) => AssistantSimilarIncidentSchema.parse(match));
}

export function registerAssistantRoutes(
  app: FastifyInstance,
  context: RouteContext,
  makeResponder: typeof createAssistantResponder = createAssistantResponder,
): void {
  const { runtime, env, operatorToken } = context;
  const liveEnabled = liveAnalysisEnabled(env, operatorToken);
  const responder: AssistantResponder = makeResponder({
    apiKey: env.CODEX_SALE_API_KEY?.trim() || undefined,
    model: env.CODEX_SALE_MODEL?.trim() || undefined,
    baseUrl: env.CODEX_SALE_BASE_URL?.trim() || "https://codex.sale/v1",
    timeoutMs: positiveInteger(env.MTS_AI_TIMEOUT_MS, 8_000),
  });
  const cached = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<AssistantChatResponse>>();
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

  async function deliver(prepared: ReturnType<AssistantResponder["prepare"]>, useLive: boolean): Promise<AssistantChatResponse> {
    const began = performance.now();
    try {
      const result = AssistantChatResponseSchema.parse(await responder.run(prepared, { useLive }));
      if (useLive && result.reason && result.reason !== "rules_mode" && result.reason !== null) {
        app.log.warn({ reason: result.reason, durationMs: Math.round(performance.now() - began) }, "Резервный ответ помощника.");
      }
      return result;
    } catch {
      app.log.warn({ reason: "provider_error", durationMs: Math.round(performance.now() - began) }, "Резервный ответ помощника.");
      return { ...AssistantChatResponseSchema.parse(prepared.rules), reason: "provider_error" };
    }
  }

  app.post(`${API_PREFIX}/assistant/chat`, async (request, reply) => {
    const parsed = AssistantChatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(INVALID_REQUEST);

    const header = request.headers.authorization;
    const authorized = isValidOperatorToken(operatorToken, readBearer(header));
    if (header !== undefined && !authorized) return reply.code(403).send(INVALID_OPERATOR_TOKEN);

    const useLive = liveEnabled && authorized;
    const snapshot = runtime.getSnapshot();
    const resolved = resolveAssistantQuery(runtime, parsed.data);
    const matches = toMatches(resolved.search);
    const prepared = responder.prepare({
      mode: parsed.data.mode,
      question: parsed.data.question,
      context: resolved.context,
      incident: resolved.incident,
      description: resolved.description,
      searchStatus: resolved.searchStatus,
      matches,
      now: snapshot.serverNow,
    });

    const key = JSON.stringify([
      snapshot.revision,
      parsed.data.mode,
      resolved.context,
      parsed.data.question,
      useLive,
      prepared.key,
    ]);
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
    const work = deliver(prepared, useLive).then((result) => {
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