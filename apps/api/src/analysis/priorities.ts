import { createPriorityProvider, ProviderError } from "@mts/analysis";
import { buildPriorityFeed, preparePriorityFacts, type IncidentAnnotation, type PriorityFacts } from "@mts/analysis/priorities";
import { API_PREFIX, priorityResetSequence, prioritySlaKey, type ApiError, type PriorityFeed, type Snapshot } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { analyzerConfig, liveAnalysisEnabled } from "../http/config.js";
import { INVALID_OPERATOR_TOKEN, isValidOperatorToken, readBearer } from "../http/operator-token.js";
import type { RouteContext } from "../runtime-contract.js";

const SNAPSHOT_CHANGED = {
  code: "PRIORITIES_STALE", message: "Снимок изменился во время расчёта. Повторите запрос.",
} satisfies ApiError;

const BATCH_SIZE = 18;
const MAX_LIVE_MS = 24_000;
const RETRY_MS = 30_000;

type CachedAnnotation = { version: string; value: IncidentAnnotation };
type CacheEntry = { key: string; value: PriorityFeed; retryAt: number };
type Work = { revision: number; cancellation: AbortController; done: Promise<PriorityFeed["fallback"]> };

export function registerPriorityFeed(app: FastifyInstance, { runtime, env, operatorToken }: RouteContext): void {
  const liveEnabled = liveAnalysisEnabled(env, operatorToken);
  const provider = createPriorityProvider(analyzerConfig(env));
  const annotations = new Map<string, CachedAnnotation>();
  const cached = new Map<boolean, CacheEntry>();
  let active: Work | undefined;
  let resetSequence = priorityResetSequence(runtime.getSnapshot());

  const unsubscribe = runtime.subscribe((snapshot) => {
    const reset = priorityResetSequence(snapshot);
    if (reset !== null && reset !== resetSequence) {
      resetSequence = reset;
      annotations.clear();
      cached.clear();
    }
    if (active && active.revision !== snapshot.revision) active.cancellation.abort();
    if (annotations.size) {
      const current = new Map(snapshot.incidents.map(({ id, version }) => [id, version]));
      for (const [id, { version }] of annotations) {
        if (current.get(id) !== version) annotations.delete(id);
      }
    }
  });

  app.addHook("onClose", async () => {
    unsubscribe();
    active?.cancellation.abort();
  });

  function factsFor(snapshot: Snapshot): Map<string, PriorityFacts> {
    return new Map(snapshot.incidents.map((incident) => [
      incident.id, preparePriorityFacts(incident, runtime.getDescription(incident.id)),
    ]));
  }

  function validAnnotations(snapshot: Snapshot): Map<string, IncidentAnnotation> {
    const valid = new Map<string, IncidentAnnotation>();
    for (const { id, version } of snapshot.incidents) {
      const item = annotations.get(id);
      if (item?.version === version) valid.set(id, item.value);
    }
    return valid;
  }

  async function annotate(snapshot: Snapshot, facts: ReadonlyMap<string, PriorityFacts>, cancellation: AbortSignal) {
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(MAX_LIVE_MS)]);
    const missing = new Map(snapshot.incidents.filter(({ id, version }) => annotations.get(id)?.version !== version)
      .map(({ id, version }) => [id, { ...facts.get(id)!, id, version }]));
    const entries = [...missing.values()];
    try {
      for (let start = 0; start < entries.length; start += BATCH_SIZE) {
        signal.throwIfAborted();
        const batch = entries.slice(start, start + BATCH_SIZE);
        const results = await provider(batch, signal);
        // A replaced snapshot or demo reset invalidates the pending batch.
        signal.throwIfAborted();
        for (const { id, version } of batch) annotations.set(id, { version, value: results.get(id)! });
      }
      return null;
    } catch (error) {
      const reason = signal.aborted ? "timeout" : error instanceof ProviderError ? error.reason : "provider_error";
      if (!cancellation.aborted) app.log.warn({ reason }, "Резервный расчёт приоритетов.");
      return reason;
    }
  }

  function start(snapshot: Snapshot, facts: ReadonlyMap<string, PriorityFacts>): Work {
    const cancellation = new AbortController();
    const work: Work = {
      revision: snapshot.revision,
      cancellation,
      done: annotate(snapshot, facts, cancellation.signal).finally(() => {
        if (active === work) active = undefined;
      }),
    };
    active = work;
    return work;
  }

  function cacheKey(snapshot: Snapshot, nowMs: number) {
    return JSON.stringify([snapshot.revision, priorityResetSequence(snapshot), prioritySlaKey(snapshot.incidents, nowMs)]);
  }

  app.post(`${API_PREFIX}/incidents/priorities`, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const header = request.headers.authorization;
    const authorized = isValidOperatorToken(operatorToken, readBearer(header));
    if (header !== undefined && !authorized) return reply.code(403).send(INVALID_OPERATOR_TOKEN);
    const useLive = liveEnabled && authorized;
    const snapshot = runtime.getSnapshot();
    const nowMs = Date.parse(snapshot.serverNow);
    const hit = cached.get(useLive);
    if (hit?.key === cacheKey(snapshot, nowMs) && Date.now() < hit.retryAt) return hit.value;

    const facts = factsFor(snapshot);
    let fallback: PriorityFeed["fallback"] = null;
    if (useLive && snapshot.incidents.length) {
      if (active && active.revision !== snapshot.revision) await active.done;
      if (runtime.getSnapshot().revision !== snapshot.revision) return reply.code(409).send(SNAPSHOT_CHANGED);
      const work = active ?? start(snapshot, facts);
      fallback = await work.done;
    }

    const current = runtime.getSnapshot();
    if (current.revision !== snapshot.revision) return reply.code(409).send(SNAPSHOT_CHANGED);
    const evaluatedMs = Date.parse(current.serverNow);
    const key = cacheKey(current, evaluatedMs);
    const completed = cached.get(useLive);
    if (completed?.key === key && Date.now() < completed.retryAt) return completed.value;

    const result = buildPriorityFeed(current, evaluatedMs, facts, useLive ? validAnnotations(current) : undefined, fallback);
    cached.set(useLive, { key, value: result, retryAt: fallback ? Date.now() + RETRY_MS : Infinity });
    return result;
  });
}
