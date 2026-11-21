import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX, COORDINATOR_TEAM, isActiveState, SnapshotSchema } from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureDemoData } from "../src/demo/index.js";
import { BASELINE_FILENAME, incidentState, LIVE_FILENAME, readIncidentBytes } from "../src/source/input.js";
import { createApp } from "../src/start.js";

const operatorToken = "operator-test-token";
const demoId = "INC000000000001";
const timerId = "INC000000000002";
const resetUrl = `${API_PREFIX}/demo/reset`;
const dashboardUrl = `${API_PREFIX}/dashboard`;

describe("synthetic demo data and reset", () => {
  let root: string;
  let live: string;
  let baseline: string;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mts-api-demo-"));
    live = join(root, LIVE_FILENAME);
    baseline = join(root, BASELINE_FILENAME);
    app = undefined;
  });

  afterEach(async () => {
    try {
      await app?.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function start(token?: string) {
    app = await createApp({ MTS_DATA_DIR: root, MTS_DATA_POLL_MS: "5", MTS_OPERATOR_TOKEN: token });
    return app;
  }

  function reset(server: FastifyInstance, authorization?: string) {
    return server.inject({
      method: "POST",
      url: resetUrl,
      headers: authorization ? { authorization } : undefined,
    });
  }

  it("seeds only a fresh directory with identical baseline and live demo sources", async () => {
    const now = Date.parse("2032-06-03T12:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    try {
      await ensureDemoData(root);
    } finally {
      vi.useRealTimers();
    }
    const source = await readFile(live);
    expect(await readFile(baseline)).toEqual(source);
    const incidents = readIncidentBytes(source);
    const active = incidents.filter((incident) => isActiveState(incidentState(incident)));
    expect(active.filter(({ priorityId }) => priorityId === 3).length).toBeGreaterThanOrEqual(2);
    expect(active.some(({ priorityId }) => priorityId === 4)).toBe(false);
    expect(active.some(({ assignedGroupName }) => assignedGroupName === COORDINATOR_TEAM)).toBe(true);
    expect(active.some(({ id }) => id === demoId)).toBe(true);
    const timer = active.find(({ id }) => id === timerId);
    expect(timer).toBeDefined();
    expect(now - Date.parse(timer!.submitDate)).toBeGreaterThanOrEqual(20 * 60 * 1000);
    expect(incidents.find((incident) => incidentState(incident) === "Research")).toMatchObject({
      deadline: null,
      completionDate: expect.any(String),
    });
    expect(incidents.some((incident) => incidentState(incident) === "Closed")).toBe(true);
  });

  it("preserves existing data when either source file is absent", async () => {
    const existing = Buffer.from("[]\n");
    await writeFile(live, existing);
    await ensureDemoData(root);
    expect(await readFile(live)).toEqual(existing);
    await expect(readFile(baseline)).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(baseline, existing);
    await rm(live);
    await ensureDemoData(root);
    expect(await readFile(baseline)).toEqual(existing);
    await expect(readFile(live)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports reset unavailable when the operator token is unset", async () => {
    const server = await start();
    const dashboard = SnapshotSchema.parse((await server.inject(dashboardUrl)).json());
    expect(dashboard.capabilities.demoReset).toBe(false);
    const response = await reset(server, `Bearer ${operatorToken}`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "RESET_UNAVAILABLE" });
  });

  it("rejects missing or bad authorization and handles missing or invalid baselines", async () => {
    const server = await start(operatorToken);
    const before = SnapshotSchema.parse((await server.inject(dashboardUrl)).json());
    expect(before.capabilities.demoReset).toBe(true);
    const liveBytes = await readFile(live);
    await rm(baseline);

    for (const authorization of [undefined, "Basic bad", "Bearer operator-test-tokeN"]) {
      const denied = await reset(server, authorization);
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ code: "OPERATOR_TOKEN_INVALID" });
    }

    const bearer = `Bearer ${operatorToken}`;
    for (const invalid of [undefined, "{ malformed", '[{"id":"missing-fields"}]']) {
      if (invalid !== undefined) await writeFile(baseline, invalid);
      const unavailable = await reset(server, bearer);
      expect(unavailable.statusCode).toBe(409);
      expect(unavailable.json()).toMatchObject({ code: "BASELINE_UNAVAILABLE" });
      expect(await readFile(live)).toEqual(liveBytes);
      expect((await server.inject(dashboardUrl)).json()).toMatchObject({ revision: before.revision, notices: [] });
    }
  });

  it("restores baseline after restart and replaces old notices without reusing seq", async () => {
    const initialServer = await start(operatorToken);
    const initial = SnapshotSchema.parse((await initialServer.inject(dashboardUrl)).json());
    const baselineBytes = await readFile(baseline);
    await initialServer.close();
    app = undefined;

    const promoted = readIncidentBytes(baselineBytes).map((incident) => (
      incident.id === demoId ? { ...incident, priorityId: 4, priority: "Наивысший" } : incident
    ));
    await writeFile(live, JSON.stringify(promoted));
    const server = await start(operatorToken);
    const changed = SnapshotSchema.parse((await server.inject(dashboardUrl)).json());
    expect(changed.revision).toBe(initial.revision + 1);
    expect(changed.groups.critical).toContain(demoId);
    expect(changed.notices).toEqual([expect.objectContaining({ kind: "critical.new", incidentId: demoId })]);

    const response = await reset(server, `Bearer ${operatorToken}`);
    expect(response.statusCode).toBe(200);
    const restored = SnapshotSchema.parse(response.json());
    expect(restored.incidents).toEqual(initial.incidents);
    expect(restored.groups).toEqual(initial.groups);
    expect(restored.revision).toBe(changed.revision + 1);
    expect(restored.notices).toEqual([expect.objectContaining({
      kind: "demo.reset",
      seq: changed.notices[0].seq + 1,
    })]);
    expect(await readFile(live)).toEqual(baselineBytes);
  });
});
