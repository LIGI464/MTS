import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { AnalysisInput, Analyzer, PreparedAnalysis } from "@mts/analysis";
import { AnalysisResultSchema, API_PREFIX, SnapshotSchema, type AnalysisResult } from "@mts/contracts";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerAnalysisRoutes } from "../src/analysis/index.ts";
import { registerEvents } from "../src/http/events.ts";
import type { DashboardRuntime } from "../src/runtime-contract.ts";
import { atomicWrite } from "../src/source/file.ts";
import { createDashboardRuntime } from "../src/source/index.ts";
import { LIVE_FILENAME } from "../src/source/input.ts";

const TOKEN = "test-operator";
const records = [
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `INC-${index}`,
    header: `Синтетическая карточка ${index}`,
    description: "Внутреннее описание",
    submitDate: "2026-05-21 10:00:00",
    priorityId: 3,
    stateEnum: "Assigned",
  })),
  {
    id: "INC-HISTORY",
    header: "Устранённая неисправность",
    description: "Прошлая запись",
    submitDate: "2026-05-21 06:00:00",
    priorityId: 2,
    stateEnum: "Resolved",
  },
];

const asBytes = (items: typeof records) => Buffer.from(JSON.stringify(items));
const baseline = asBytes(records);

function prepareResult(input: AnalysisInput): PreparedAnalysis {
  return {
    key: `${input.incident.id}/${input.incident.version}`,
    caseFacts: {},
    candidateNames: [],
    rules: {
      incidentId: input.incident.id,
      incidentVersion: input.incident.version,
      evaluatedAt: input.now,
      source: "rules",
      summary: "Оценка по правилам",
      recommendedTeam: null,
      risk: { level: "low", factors: [] },
      reason: "rules_mode",
    },
  };
}

function modelAnswer(prepared: PreparedAnalysis, summary = "Оценка модели"): AnalysisResult {
  return { ...prepared.rules, source: "llm", reason: null, summary };
}

describe("Analysis HTTP", () => {
  let directory: string;
  let runtime: DashboardRuntime | undefined;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "mts-api-analysis-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await app?.close();
    } finally {
      await runtime?.close();
      await rm(directory, { force: true, recursive: true });
      app = undefined;
      runtime = undefined;
    }
  });

  async function setup(
    run: Analyzer["run"] = async (prepared, { useLive }) => useLive ? modelAnswer(prepared) : prepared.rules,
    live = true,
  ) {
    const livePath = join(directory, LIVE_FILENAME);
    await atomicWrite(livePath, baseline);
    const source = await createDashboardRuntime({
      dataDir: directory,
      pollMs: 15,
      capabilities: { demoReset: true, liveAnalysis: live },
    });
    runtime = source;
    const server = Fastify({ logger: false });
    app = server;
    const analyzer = { prepare: vi.fn(prepareResult), run: vi.fn(run) };
    const env = {
      MTS_AI_MODE: live ? "live" : "rules",
      MTS_OPERATOR_TOKEN: TOKEN,
      CODEX_SALE_API_KEY: "test-key",
      CODEX_SALE_MODEL: "test-model",
      CODEX_SALE_BASE_URL: "https://example.invalid/v1",
      MTS_AI_TIMEOUT_MS: "9000",
    };
    const factory = vi.fn(() => analyzer);
    registerAnalysisRoutes(server, { runtime: source, dataDir: directory, operatorToken: TOKEN, env }, factory);
    registerEvents(server, source);
    await server.ready();

    const post = (index: number | string, authorization?: string) => Promise.resolve(server.inject({
      method: "POST",
      url: `${API_PREFIX}/incidents/INC-${index}/analysis`,
      headers: authorization === undefined ? {} : { authorization },
    }));
    const authorized = (index: number) => post(index, `Bearer ${TOKEN}`);

    return { server, source, livePath, factory, ...analyzer, post, authorized };
  }

  it("validates the ID and bearer and passes the description, history and server time to local rules", async () => {
    const test = await setup();
    const unknown = await test.post("UNKNOWN");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: "INCIDENT_NOT_FOUND" });

    for (const header of ["Bearer wrong", "Basic invalid"]) {
      const rejected = await test.post(0, header);
      expect(rejected.statusCode).toBe(403);
      expect(rejected.json()).toMatchObject({ code: "OPERATOR_TOKEN_INVALID" });
    }
    expect(test.run).not.toHaveBeenCalled();

    const result = await test.post(0);
    expect(result.statusCode).toBe(200);
    expect(AnalysisResultSchema.parse(result.json())).toMatchObject({ source: "rules", incidentId: "INC-0" });
    const [input] = test.prepare.mock.calls[0]!;
    expect(input).toMatchObject({
      incident: { id: "INC-0" },
      description: records[0]!.description,
      history: expect.arrayContaining([expect.objectContaining({ id: "INC-HISTORY", state: "Resolved" })]),
      now: result.json().evaluatedAt,
    });
    expect(test.run).toHaveBeenCalledWith(expect.anything(), { useLive: false });
    expect(test.factory).toHaveBeenCalledWith({
      apiKey: "test-key", model: "test-model", baseUrl: "https://example.invalid/v1", timeoutMs: 9000,
    });
  });

  it("keeps authorized requests in rules mode when the server is configured for rules", async () => {
    const test = await setup(undefined, false);
    const result = await test.authorized(0);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ source: "rules" });
    expect(test.run).toHaveBeenCalledWith(expect.anything(), { useLive: false });
  });

  it("deduplicates live work, caches it separately from rules and uses a new version after a file update", async () => {
    const release = Promise.withResolvers<void>();
    const test = await setup(async (prepared, { useLive }) => {
      if (!useLive) return prepared.rules;
      await release.promise;
      return modelAnswer(prepared);
    });

    await test.post(0);
    const left = test.authorized(0);
    const right = test.authorized(0);
    try {
      await expect.poll(() => test.prepare.mock.calls.length).toBe(3);
      expect(test.run).toHaveBeenCalledTimes(2);
      expect(test.run).toHaveBeenLastCalledWith(expect.anything(), { useLive: true });
    } finally {
      release.resolve();
    }

    const [first, second] = await Promise.all([left, right]);
    expect(first.json()).toEqual(second.json());
    expect(first.json()).toMatchObject({ source: "llm" });
    expect((await test.authorized(0)).json()).toEqual(first.json());
    expect((await test.post(0)).json()).toMatchObject({ source: "rules" });
    expect(test.run).toHaveBeenCalledTimes(2);

    const initialVersion = first.json().incidentVersion;
    await atomicWrite(test.livePath, asBytes(
      records.map((item) => item.id === "INC-0" ? { ...item, description: "Новое описание" } : item),
    ));
    await expect.poll(() => test.source.getSnapshot().incidents[0]?.version).not.toBe(initialVersion);
    const changed = await test.authorized(0);
    expect(changed.statusCode).toBe(200);
    expect(changed.json().incidentVersion).not.toBe(initialVersion);
    expect(test.run).toHaveBeenCalledTimes(3);
  });

  it("invalidates cached and in-flight answers on reset even when a version stays the same", async () => {
    const release = Promise.withResolvers<void>();
    let paidForFirstIncident = 0;
    const test = await setup(async (prepared) => {
      if (prepared.rules.incidentId === "INC-0" && ++paidForFirstIncident === 1) {
        await release.promise;
        return modelAnswer(prepared, "До сброса");
      }
      return modelAnswer(prepared, "После сброса");
    });

    const old = test.authorized(0);
    try {
      await expect.poll(() => test.run.mock.calls.length).toBe(1);
      expect((await test.authorized(1)).statusCode).toBe(200);
      const originalVersion = test.source.getSnapshot().incidents[0]?.version;
      const reset = await test.source.resetTo(baseline);
      expect(reset.incidents[0]?.version).toBe(originalVersion);

      const fresh = await test.authorized(0);
      expect(fresh.statusCode).toBe(200);
      expect(fresh.json()).toMatchObject({ summary: "После сброса", incidentVersion: originalVersion });
      release.resolve();
      expect((await old).json()).toMatchObject({ summary: "До сброса" });
      expect((await test.authorized(0)).json()).toEqual(fresh.json());
      expect((await test.authorized(1)).statusCode).toBe(200);
      expect(test.run).toHaveBeenCalledTimes(4);
    } finally {
      release.resolve();
      await old;
    }
  });

  it("limits concurrent provider calls while allowing rules and identical requests", async () => {
    const release = Promise.withResolvers<void>();
    const test = await setup(async (prepared, { useLive }) => {
      if (!useLive) return prepared.rules;
      await release.promise;
      return modelAnswer(prepared);
    });
    const first = test.authorized(0);
    const second = test.authorized(1);
    try {
      await expect.poll(() => test.run.mock.calls.length).toBe(2);
      const repeated = test.authorized(0);
      const limited = await test.authorized(2);
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ code: "TOO_MANY_REQUESTS" });
      expect((await test.post(2)).json()).toMatchObject({ source: "rules" });
      release.resolve();
      for (const result of await Promise.all([first, second, repeated])) expect(result.statusCode).toBe(200);
      expect(test.run).toHaveBeenCalledTimes(3);
      expect((await test.authorized(2)).statusCode).toBe(200);
    } finally {
      release.resolve();
      await Promise.all([first, second]);
    }
  });

  it("limits the rolling minute of external calls and lets cache hits through", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    const test = await setup();
    for (let index = 0; index < 8; index++) {
      expect((await test.authorized(index)).statusCode).toBe(200);
    }
    expect((await test.authorized(8)).statusCode).toBe(429);
    expect((await test.authorized(0)).statusCode).toBe(200);
    expect(test.run).toHaveBeenCalledTimes(8);
    clock.mockReturnValue(60_099);
    expect((await test.authorized(8)).statusCode).toBe(429);
    clock.mockReturnValue(60_101);
    expect((await test.authorized(8)).statusCode).toBe(200);
    expect(test.run).toHaveBeenCalledTimes(9);
  });

  it("uses a short cache for a local fallback after a failed provider call", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(100);
    const test = await setup(async (prepared) => ({ ...prepared.rules, reason: "provider_error" }));
    expect((await test.authorized(0)).json()).toMatchObject({ source: "rules", reason: "provider_error" });
    clock.mockReturnValue(30_099);
    expect((await test.authorized(0)).statusCode).toBe(200);
    expect(test.run).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(30_101);
    expect((await test.authorized(0)).statusCode).toBe(200);
    expect(test.run).toHaveBeenCalledTimes(2);
  });

  it("rejects an otherwise valid model answer for the wrong incident version", async () => {
    const test = await setup(async (prepared) => ({ ...modelAnswer(prepared), incidentVersion: "stale-version" }));
    const result = await test.authorized(0);
    expect(result.statusCode).toBe(200);
    expect(AnalysisResultSchema.parse(result.json())).toMatchObject({
      incidentId: "INC-0",
      incidentVersion: test.source.getSnapshot().incidents[0]?.version,
      source: "rules",
      reason: "invalid_output",
    });
  });

  it("publishes the next SSE snapshot while a provider request is still pending", async () => {
    const release = Promise.withResolvers<void>();
    const test = await setup(async (prepared) => {
      await release.promise;
      return modelAnswer(prepared);
    });
    const address = await test.server.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const pending = test.authorized(0);
    try {
      await expect.poll(() => test.run.mock.calls.length).toBe(1);
      const stream = await fetch(`${address}${API_PREFIX}/events`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
      });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      async function frame() {
        while (!buffered.includes("\n\n")) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Поток закрылся до кадра дашборда");
          buffered += decoder.decode(chunk.value, { stream: true });
        }
        const boundary = buffered.indexOf("\n\n");
        const value = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const prefix = "event: dashboard\ndata: ";
        expect(value).toMatch(/^event: dashboard\ndata: /);
        return SnapshotSchema.parse(JSON.parse(value.slice(prefix.length)));
      }
      const initial = await frame();
      await atomicWrite(test.livePath, asBytes(records.map((item) =>
        item.id === "INC-0" ? { ...item, priorityId: 4 } : item,
      )));
      const updated = await frame();
      expect(updated.revision).toBe(initial.revision + 1);
      expect(updated.groups.critical).toContain("INC-0");
      release.resolve();
      expect((await pending).statusCode).toBe(200);
    } finally {
      controller.abort();
      release.resolve();
      await pending;
    }
  });
});
