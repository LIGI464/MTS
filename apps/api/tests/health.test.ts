import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { get, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX, COORDINATOR_TEAM, SnapshotSchema } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/http/index.ts";
import type { DashboardRuntime } from "../src/runtime-contract.ts";
import { createDashboardRuntime } from "../src/source/index.ts";
import { atomicWrite } from "../src/source/file.ts";
import { LIVE_FILENAME } from "../src/source/input.ts";

const incident = {
  id: "INC-SSE",
  header: "Синтетический инцидент",
  submitDate: "2026-05-21 10:00:00",
  priorityId: 3,
  stateEnum: "Assigned",
};

async function connectEvents(address: string) {
  const controller = new AbortController();
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(`${address}${API_PREFIX}/events`, {
      agent: false,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
    }, resolve);
    request.once("error", reject);
  });
  const reader = response[Symbol.asyncIterator]();
  const decoder = new TextDecoder();
  let buffered = "";

  return {
    response,
    async next() {
      for (;;) {
        const boundary = buffered.indexOf("\n\n");
        if (boundary !== -1) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (frame.startsWith(":")) continue;
          const [event, data] = frame.split("\n");
          expect(event).toBe("event: dashboard");
          expect(data).toMatch(/^data: /);
          return SnapshotSchema.parse(JSON.parse(data.slice("data: ".length)));
        }

        const result = await reader.next();
        if (result.done) throw new Error("SSE закончился до следующего снимка");
        buffered += decoder.decode(result.value, { stream: true });
      }
    },
    finish: () => reader.next(),
    abort: () => controller.abort(),
  };
}

describe("Dashboard HTTP", () => {
  let root: string;
  let app: FastifyInstance | undefined;
  let runtime: DashboardRuntime | undefined;

  beforeEach(async () => {
    app = undefined;
    runtime = undefined;
    root = await mkdtemp(join(tmpdir(), "mts-api-http-"));
  });

  afterEach(async () => {
    try {
      await app?.close();
    } finally {
      await runtime?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  async function makeApp(webRoot?: string) {
    runtime = await createDashboardRuntime({
      dataDir: root,
      pollMs: 20,
      capabilities: { demoReset: false, liveAnalysis: false },
    });
    app = buildApp({ runtime, dataDir: root, env: {} }, webRoot);
    return app;
  }

  it("serves health and an unavailable dashboard on cold start", async () => {
    const server = await makeApp();
    const health = await server.inject("/healthz");
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", source: "unavailable" });

    const response = await server.inject(`${API_PREFIX}/dashboard`);
    expect(response.statusCode).toBe(200);
    expect(SnapshotSchema.parse(response.json())).toMatchObject({
      revision: 0,
      source: { status: "unavailable", lastGoodAt: null },
      incidents: [],
      groups: { critical: [], coordinator: [], high: [], research: [] },
      notices: [],
    });
  });

  it("bounds action bodies and returns API errors", async () => {
    const server = await makeApp();
    server.post(`${API_PREFIX}/test-body`, async () => ({ ok: true }));

    const missing = await server.inject(`${API_PREFIX}/unknown`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "NOT_FOUND", message: expect.any(String) });

    const oversized = await server.inject({
      method: "POST",
      url: `${API_PREFIX}/test-body`,
      payload: { text: "x".repeat(8 * 1024) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toEqual({ code: expect.any(String), message: expect.any(String) });
  });

  it("serves uncached HTML on client routes and keeps unknown API paths out of the SPA", async () => {
    const webRoot = join(root, "web");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Пульт</title>");
    await writeFile(join(webRoot, "assets", "index-D8uvRB27.js"), "export {};");
    const server = await makeApp(webRoot);

    for (const url of ["/", "/admin/incidents", "/admin/incidents/INC-SSE"]) {
      const response = await server.inject(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^text\/html/);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toContain("<title>Пульт</title>");
    }

    const asset = await server.inject("/assets/index-D8uvRB27.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toBe("export {};");
    expect(asset.headers["cache-control"]).toContain("immutable");

    for (const url of [`${API_PREFIX}/unknown`, "/assets/unknown.js"]) {
      const missing = await server.inject(url);
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("streams an archive-only revision after the updated ticket is readable", async () => {
    const live = join(root, LIVE_FILENAME);
    await writeFile(live, JSON.stringify([incident]));
    const server = await makeApp();
    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    const client = await connectEvents(address);
    try {
      const initial = await client.next();
      const solution = "Синтетическое решение";
      await atomicWrite(live, Buffer.from(JSON.stringify([{ ...incident, solution }])));
      const updated = await client.next();
      expect(updated).toMatchObject({
        revision: initial.revision + 1, incidents: initial.incidents, notices: initial.notices,
      });
      const response = await fetch(`${address}${API_PREFIX}/itsm/incidents/${incident.id}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        solution, ticket: { state: "Assigned", hasSolution: true }, history: [{ solution }, { solution: null }],
      });
    } finally {
      client.abort();
    }
  });

  it("streams complete snapshots to two clients and reconnects with the current journal", async () => {
    const live = join(root, LIVE_FILENAME);
    await writeFile(live, JSON.stringify([incident]));
    const server = await makeApp();
    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    const clients: Awaited<ReturnType<typeof connectEvents>>[] = [];

    async function connect() {
      const client = await connectEvents(address);
      clients.push(client);
      return client;
    }

    try {
      const [left, right] = await Promise.all([connect(), connect()]);
      for (const client of [left, right]) {
        expect(client.response.statusCode).toBe(200);
        expect(client.response.headers["content-type"]).toMatch(/^text\/event-stream/);
        expect(client.response.headers["cache-control"]).toBe("no-cache, no-transform");
        expect(client.response.headers["x-accel-buffering"]).toBe("no");
      }

      const [initial, otherInitial] = await Promise.all([left.next(), right.next()]);
      expect(initial).toMatchObject({
        source: { status: "ok" },
        groups: { high: [incident.id], critical: [], coordinator: [], research: [] },
        notices: [],
      });
      expect(otherInitial.revision).toBe(initial.revision);
      expect(otherInitial.groups).toEqual(initial.groups);

      const criticalBytes = new TextEncoder().encode(JSON.stringify([
        { ...incident, priorityId: 4, assignedGroupName: COORDINATOR_TEAM },
      ]));
      await atomicWrite(live, criticalBytes);
      const [critical, otherCritical] = await Promise.all([left.next(), right.next()]);
      expect(critical.revision).toBe(initial.revision + 1);
      expect(critical.groups.critical).toEqual([incident.id]);
      expect(critical.groups.coordinator).toEqual([incident.id]);
      expect(critical.notices.map(({ kind }) => kind)).toEqual(["critical.new", "coordinator.assigned"]);
      expect(otherCritical.notices).toEqual(critical.notices);

      await atomicWrite(live, new TextEncoder().encode("{invalid"));
      const [stale, otherStale] = await Promise.all([left.next(), right.next()]);
      for (const snapshot of [stale, otherStale]) {
        expect(snapshot.revision).toBe(critical.revision);
        expect(snapshot.source.status).toBe("stale");
        expect(snapshot.incidents).toEqual(critical.incidents);
        expect(snapshot.notices).toEqual(critical.notices);
      }

      left.abort();
      const reconnected = await connect();
      expect(await reconnected.next()).toMatchObject({
        revision: critical.revision,
        source: { status: "stale" },
        notices: critical.notices,
      });

      await atomicWrite(live, criticalBytes);
      const recovered = await Promise.all([right.next(), reconnected.next()]);
      for (const snapshot of recovered) {
        expect(snapshot.revision).toBe(critical.revision);
        expect(snapshot.source.status).toBe("ok");
        expect(snapshot.notices).toEqual(critical.notices);
      }

      const [, rightEnd, reconnectedEnd] = await Promise.all([
        server.close(),
        right.finish(),
        reconnected.finish(),
      ]);
      app = undefined;
      expect(rightEnd.done).toBe(true);
      expect(reconnectedEnd.done).toBe(true);
    } finally {
      clients.forEach((client) => client.abort());
    }
  }, 8000);
});
