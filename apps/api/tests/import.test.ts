import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  API_PREFIX, FullTicketDetailSchema, ImportApplyResultSchema, ImportPreviewResultSchema, SnapshotSchema,
  type ImportApplyRequest,
} from "@mts/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as files from "../src/source/file.js";
import { BASELINE_FILENAME, LIVE_FILENAME, fingerprint, sha256 } from "../src/source/input.js";
import { createApp } from "../src/start.js";
import { openDashboardStore } from "../src/store/index.js";

const importPath = `${API_PREFIX}/incidents/import`;
const token = "synthetic-d24-operator";
const requestId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const common = { stateEnum: "Assigned", submitDate: "2034-06-03 11:30:00" };
const primary = { ...common, id: "SYN-D24/A", priorityId: 1, solution: "Решение A", ext: { values: [false, 0, null] } };
const removed = { ...common, id: "SYN-D24/B", priorityId: 2, stateEnum: "Closed", stateId: 10, solution: "Решение B" };
const stable = { ...common, id: "SYN-D24/C", priorityId: 3, description: `Синтетический экспорт ${"x".repeat(12 * 1024)}` };
const added = { ...common, id: "SYN-D24/D", priorityId: 4, sysId: "00090071992547409939999", deadline: "" };
const edited = { ...primary, solution: "Новое решение A" };
const reorderedStable = Object.fromEntries(Object.entries(stable).reverse());
const original = JSON.stringify([primary, removed, stable]);
const incoming = "\uFEFF" + JSON.stringify([reorderedStable, added, edited], null, 2);

describe("D24 import endpoints", () => {
  let dir: string;
  let live: string;
  let baseline: string;
  let databasePath: string;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mts-d24-"));
    live = join(dir, LIVE_FILENAME);
    baseline = join(dir, BASELINE_FILENAME);
    databasePath = join(dir, "dashboard.sqlite");
    await writeFile(live, original);
    await writeFile(baseline, original);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    try {
      await app?.close();
    } finally {
      app = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function start(operator = true) {
    await app?.close();
    app = await createApp({ MTS_DATA_DIR: dir, MTS_DATA_POLL_MS: "20", MTS_OPERATOR_TOKEN: operator ? token : undefined });
    return app;
  }

  function post(path: string, payload: object, authorization = `Bearer ${token}`) {
    return app!.inject({ method: "POST", url: path, payload, headers: { authorization } });
  }

  function submitPreview(jsonText: string) {
    return post(`${importPath}/preview`, { fileName: "synthetic.json", jsonText });
  }

  async function preview(jsonText = incoming) {
    const response = await submitPreview(jsonText);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const parsed = ImportPreviewResultSchema.parse(response.json());
    if (!parsed.valid) throw new Error("Expected a valid synthetic preview");
    return parsed;
  }

  function apply(command: ImportApplyRequest) {
    return post(`${importPath}/apply`, command);
  }

  async function snapshot() {
    return SnapshotSchema.parse((await app!.inject(`${API_PREFIX}/dashboard`)).json());
  }

  async function ticket(id: string) {
    return FullTicketDetailSchema.parse((await app!.inject(`${API_PREFIX}/itsm/incidents/${encodeURIComponent(id)}`)).json());
  }

  it("checks Bearer before parsing, limits bodies and reports validation errors without any writes", async () => {
    await start(false);
    for (const action of ["preview", "apply"]) {
      expect((await post(`${importPath}/${action}`, {})).statusCode).toBe(404);
    }
    await start();
    for (const action of ["preview", "apply"]) {
      expect((await post(`${importPath}/${action}`, {}, "Bearer wrong")).statusCode).toBe(403);
      expect((await post(`${importPath}/${action}`, {})).statusCode).toBe(400);
    }
    const tooLarge = await submitPreview("x".repeat(2 * 1024 * 1024));
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json()).toMatchObject({ code: "BODY_TOO_LARGE", message: expect.stringContaining("2048") });

    for (const [text, errors, total, priorities] of [
      ['{"synthetic-private-sample":', /JSON/, 0, { 1: 0, 2: 0, 3: 0, 4: 0 }],
      ["{}", /массив/, 0, { 1: 0, 2: 0, 3: 0, 4: 0 }],
      [JSON.stringify([primary, { ...primary, id: ` ${primary.id} ` }]), /Запись 2.*ID уже встречался/, 2, { 1: 2, 2: 0, 3: 0, 4: 0 }],
      [JSON.stringify([primary, { ...added, priorityId: 0 }]), /Запись 2.*priorityId/, 2, { 1: 1, 2: 0, 3: 0, 4: 0 }],
    ] as const) {
      const response = await submitPreview(text);
      expect(response.statusCode).toBe(200);
      expect(ImportPreviewResultSchema.parse(response.json())).toEqual({
        valid: false, errors: [expect.stringMatching(errors)], total, byPriority: priorities, added: 0, updated: 0, archived: 0,
      });
      expect(response.body).not.toContain("synthetic-private-sample");
    }
    expect((await snapshot()).revision).toBe(1);
    expect(await readFile(live, "utf8")).toBe(original);
  });

  it("previews precise changes, applies once, retains raw fields and publishes the accepted revision by SSE", async () => {
    const server = await start();
    const before = await snapshot();
    const stableTicket = await ticket(stable.id);
    const result = await preview();
    expect(result).toEqual({
      valid: true, errors: [], total: 3, byPriority: { 1: 1, 2: 0, 3: 1, 4: 1 },
      added: 1, updated: 1, archived: 1, previewId: expect.any(String), expectedRevision: before.revision,
    });
    expect((await snapshot()).revision).toBe(before.revision);
    expect(await readFile(live, "utf8")).toBe(original);

    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    const response = await fetch(`${address}${API_PREFIX}/events`, { signal: AbortSignal.timeout(5000) });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = "";
    async function nextSnapshot() {
      while (!buffered.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("SSE ended before the next dashboard event");
        buffered += chunk.value;
      }
      const boundary = buffered.indexOf("\n\n");
      const frame = buffered.slice(0, boundary);
      buffered = buffered.slice(boundary + 2);
      expect(frame).toMatch(/^event: dashboard\ndata: /);
      return SnapshotSchema.parse(JSON.parse(frame.slice("event: dashboard\ndata: ".length)));
    }

    const command = { previewId: result.previewId, expectedRevision: result.expectedRevision, requestId: requestId(1) };
    const receipt = { revision: before.revision + 1 };
    try {
      expect((await nextSnapshot()).revision).toBe(before.revision);
      const responses = await Promise.all([apply(command), apply(command)]);
      for (const applied of responses) {
        expect(applied.statusCode).toBe(200);
        expect(ImportApplyResultSchema.parse(applied.json())).toEqual(receipt);
      }
      const event = await nextSnapshot();
      expect(event.revision).toBe(receipt.revision);
      expect(event.incidents.map(({ id }) => id)).toEqual([primary.id, stable.id, added.id]);
      expect(event.notices).toMatchObject([{ kind: "critical.new", incidentId: added.id }]);
    } finally {
      await reader.cancel();
    }
    expect(await readFile(live, "utf8")).toBe(incoming);
    expect(await readFile(baseline, "utf8")).toBe(original);
    expect(await ticket(stable.id)).toEqual(stableTicket);
    expect(await ticket(removed.id)).toMatchObject({ ticket: { present: false }, rawFields: removed });
    expect((await ticket(removed.id)).history.map(({ present }) => present)).toEqual([false, true]);
    expect((await ticket(primary.id)).history.map(({ solution }) => solution)).toEqual([edited.solution, primary.solution]);
    expect((await ticket(added.id)).rawFields).toEqual(added);

    await start();
    expect((await snapshot()).revision).toBe(receipt.revision);
    expect((await apply(command)).json()).toEqual(receipt);
    expect((await ticket(primary.id)).history).toHaveLength(2);
    expect((await ticket(removed.id)).history).toHaveLength(2);
    const reused = await apply({ ...command, expectedRevision: receipt.revision });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe("REQUEST_ID_CONFLICT");
    expect((await post(`${API_PREFIX}/dev/scenarios`, { action: "create-critical", requestId: command.requestId })).json().code)
      .toBe("REQUEST_ID_CONFLICT");
  });

  it("rejects stale previews after external edits and serializes competing imports", async () => {
    await start();
    const stale = await preview();
    const external = JSON.stringify([{ ...primary, ext: { changedExternally: true } }, stable]);
    await files.atomicWrite(live, Buffer.from(external));
    const rejected = await apply({ previewId: stale.previewId, expectedRevision: stale.expectedRevision, requestId: requestId(1) });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().code).toBe("REVISION_CONFLICT");
    expect(await readFile(live, "utf8")).toBe(external);
    const revision = (await snapshot()).revision;
    const mismatched = await apply({ previewId: stale.previewId, expectedRevision: revision, requestId: requestId(1) });
    expect(mismatched.json().code).toBe("REVISION_CONFLICT");

    const [left, right] = await Promise.all([preview(), preview("[]")]);
    const outcomes = await Promise.all([left, right].map(({ previewId, expectedRevision }, i) =>
      apply({ previewId, expectedRevision, requestId: requestId(i + 2) })));
    expect(outcomes.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(outcomes.find(({ statusCode }) => statusCode === 409)?.json().code).toBe("REVISION_CONFLICT");
    expect((await snapshot()).revision).toBe(revision + 1);
  });

  it("keeps the revision for equivalent rows, archives an empty import and disallows expired previews", async () => {
    await start();
    const originalRevision = (await snapshot()).revision;
    const equivalent = await preview(JSON.stringify([reorderedStable, removed, primary], null, 2));
    expect(equivalent).toMatchObject({ added: 0, updated: 0, archived: 0 });
    expect((await apply({ previewId: equivalent.previewId, expectedRevision: originalRevision, requestId: requestId(1) })).json())
      .toEqual({ revision: originalRevision });
    expect((await ticket(primary.id)).history).toHaveLength(1);

    const expired = await preview("[]");
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const gone = await apply({ previewId: expired.previewId, expectedRevision: originalRevision, requestId: requestId(2) });
    expect(gone.statusCode).toBe(409);
    expect(gone.json().code).toBe("PREVIEW_UNAVAILABLE");
    const empty = await preview("[]");
    expect(empty).toMatchObject({ total: 0, added: 0, updated: 0, archived: 3 });
    expect((await apply({ previewId: empty.previewId, expectedRevision: originalRevision, requestId: requestId(2) })).json())
      .toEqual({ revision: originalRevision + 1 });
    expect((await snapshot()).incidents).toHaveLength(0);
    expect((await ticket(primary.id)).ticket.present).toBe(false);
    expect(await preview(original)).toMatchObject({ total: 3, added: 3, updated: 0, archived: 0 });
  });

  it.each(["corrupt", "missing"])("can restore a %s live file from the last accepted revision", async (state) => {
    await start();
    if (state === "corrupt") await files.atomicWrite(live, Buffer.from("[invalid"));
    else await rm(live);
    const result = await preview();
    expect(result).toMatchObject({ added: 1, updated: 1, archived: 1 });
    const response = await apply({ previewId: result.previewId, expectedRevision: result.expectedRevision, requestId: requestId(1) });
    expect(response.statusCode).toBe(200);
    expect(await readFile(live, "utf8")).toBe(incoming);
    expect((await snapshot()).source.status).toBe("ok");
  });

  it("rolls back file, archive and receipt on failed writes, then retries the same command", async () => {
    await start();
    const result = await preview();
    const command = { previewId: result.previewId, expectedRevision: result.expectedRevision, requestId: requestId(1) };
    const writer = vi.spyOn(files, "atomicWrite");
    writer.mockRejectedValueOnce(new Error("synthetic write failure"));
    expect((await apply(command)).statusCode).toBe(500);

    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        CREATE TRIGGER reject_import BEFORE UPDATE ON incident_imports
        BEGIN SELECT RAISE(ABORT, 'synthetic receipt failure'); END;
      `);
      expect((await apply(command)).statusCode).toBe(500);
      expect(await readFile(live, "utf8")).toBe(original);
      expect((await snapshot()).revision).toBe(result.expectedRevision);
      expect((await ticket(primary.id)).history).toHaveLength(1);
      expect(database.prepare("SELECT count(*) AS total FROM incident_imports").get()?.total).toBe(0);
      database.exec("DROP TRIGGER reject_import");
      expect((await apply(command)).statusCode).toBe(200);
    } finally {
      database.close();
    }
  });

  it.each([true, false])("recovers an interrupted import across restart (live file replaced: %s)", async (replaced) => {
    await start();
    const { previewId, expectedRevision } = await preview();
    const command = { previewId, expectedRevision, requestId: requestId(1) };
    await app!.close();
    app = undefined;
    const store = openDashboardStore(databasePath);
    try {
      store.imports.begin({ requestId: command.requestId, fingerprint: fingerprint({ previewId, expectedRevision }), targetDigest: sha256(incoming) });
    } finally {
      store.close();
    }
    if (replaced) await writeFile(live, incoming);

    await start();
    const replay = await apply(command);
    expect(replay.statusCode).toBe(replaced ? 200 : 409);
    if (replaced) expect(replay.json()).toEqual({ revision: expectedRevision + 1 });
    else expect(replay.json().code).toBe("PREVIEW_UNAVAILABLE");
    expect((await ticket(primary.id)).history).toHaveLength(replaced ? 2 : 1);
    expect(await readFile(live, "utf8")).toBe(replaced ? incoming : original);
  });
});
