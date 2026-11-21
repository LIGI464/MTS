import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX, COORDINATOR_TEAM, NO_INCIDENT_DESCRIPTION, PriorityFeedSchema } from "@mts/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/http/index.ts";
import { atomicWrite } from "../src/source/file.ts";
import { createDashboardRuntime } from "../src/source/index.ts";
import { LIVE_FILENAME } from "../src/source/input.ts";

const token = "priority-test-operator";
const now = Date.parse("2026-11-21T12:00:00.000Z");
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const template = {
  id: "INC-1", header: "Проблема связи", submitDate: at(-60), priorityId: 3, stateEnum: "Assigned",
  assignedGroupName: "Внутренняя группа", assignedEmployee: "Имя сотрудника",
};
const rows = [
  { ...template, id: "OVERDUE", deadline: at(-4) },
  { ...template, id: "NEAR", deadline: at(3) },
  ...Array.from({ length: 22 }, (_, index) => ({ ...template, id: `LOW-${index}`, priorityId: 1 })),
  { ...template, id: "NO-FEED", priorityId: 1, shortDescription: "Периодически замедляется поиск." },
  { ...template, id: "CLOSED", priorityId: 4, stateEnum: "Closed", shortDescription: "Закрытая заявка." },
  { ...template, id: "RESEARCH", stateEnum: "Research", assignedGroupName: COORDINATOR_TEAM,
    shortDescription: "Необходимо проверить повторное появление ошибки." },
  { ...template, id: "RESEARCH-IDLE", stateEnum: "Research", assignedGroupName: COORDINATOR_TEAM },
  { ...template, id: "FAR-IMPACT", priorityId: 1, impactId: 4,
    shortDescription: "Все операторы не могут завершить оплату в кассах." },
];
const bytes = (incidents: readonly unknown[]) => Buffer.from(JSON.stringify(incidents));

type ModelEntry = { id: string; version: string; title: string; symptom: string; details: string };
type ModelRow = Pick<ModelEntry, "id" | "version"> & {
  description: string | null; blockedEvidence: string | null; widespreadEvidence: string | null;
};

function modelRows(entries: ModelEntry[]): ModelRow[] {
  return entries.map(({ id, version, symptom }) => ({
    id, version, description: id === "NO-FEED" ? "Поиск периодически работает медленнее." : symptom || null,
    blockedEvidence: id === "FAR-IMPACT" ? symptom : null,
    widespreadEvidence: id === "FAR-IMPACT" ? symptom : null,
  }));
}

function mockProvider(reply: (entries: ModelEntry[], signal?: AbortSignal | null) => Promise<Response> | Response) {
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const { input } = JSON.parse(String(options.body));
    const entries = JSON.parse(input.slice(input.indexOf("Данные заявок (JSON):\n") + "Данные заявок (JSON):\n".length));
    expect(input).not.toMatch(/Внутренняя группа|Имя сотрудника|provider-token/);
    return reply(entries, options.signal);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function providerResponse(items: ModelRow[]) {
  return Response.json({ status: "completed", output_text: JSON.stringify({ items }) });
}

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanup?.();
  cleanup = undefined;
});

async function setup(incidents: readonly unknown[] = rows, live = true) {
  const dataDir = await mkdtemp(join(tmpdir(), "mts-api-priorities-"));
  const file = join(dataDir, LIVE_FILENAME);
  await atomicWrite(file, bytes(incidents));
  const base = await createDashboardRuntime({
    dataDir, pollMs: 10, capabilities: { liveAnalysis: live, demoReset: true },
  });
  let serverNow = at(0);
  const runtime = { ...base, getSnapshot: () => ({ ...base.getSnapshot(), serverNow }) };
  const app = buildApp({ runtime, dataDir, operatorToken: token, env: {
    MTS_AI_MODE: live ? "live" : "rules",
    CODEX_SALE_API_KEY: "provider-token",
    CODEX_SALE_MODEL: "test-model",
    CODEX_SALE_BASE_URL: "https://example.invalid/v1",
    MTS_AI_TIMEOUT_MS: "1000",
  }});
  cleanup = async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  };
  await app.ready();
  function post(auth?: string) {
    return Promise.resolve(app.inject({ method: "POST", url: `${API_PREFIX}/incidents/priorities`,
      headers: auth === undefined ? {} : { authorization: auth } }));
  }
  const liveFeed = () => post(`Bearer ${token}`);
  return {
    post, liveFeed, runtime, setTime: (value: string) => { serverNow = value; },
    async update(updated: readonly unknown[]) {
      const revision = runtime.getSnapshot().revision;
      await atomicWrite(file, bytes(updated));
      await expect.poll(() => runtime.getSnapshot().revision).toBeGreaterThan(revision);
    },
  };
}

describe("dashboard priorities", () => {
  it("ranks the full accepted snapshot and returns descriptions for records outside the feed", async () => {
    const provider = mockProvider((entries) => providerResponse(modelRows(entries)));
    const app = await setup();
    const rules = PriorityFeedSchema.parse((await app.post()).json());
    expect(rules.source).toBe("rules");
    expect(rules.recommendations[0]).toMatchObject({ incidentId: "FAR-IMPACT", priority: 1, rank: 1, target: "low" });
    expect(rules.recommendations.map(({ incidentId, target }) => [incidentId, target])).toEqual([
      ["FAR-IMPACT", "low"], ["OVERDUE", "overdue"], ["NEAR", "near"], ["RESEARCH", "coordinator"],
    ]);
    expect(rules.descriptions).toHaveLength(rows.length);
    expect(rules.descriptions).toContainEqual(expect.objectContaining({ incidentId: "LOW-0", text: NO_INCIDENT_DESCRIPTION }));
    expect((await app.post("Basic invalid")).statusCode).toBe(403);
    expect((await app.post("Bearer wrong")).json()).toMatchObject({ code: "OPERATOR_TOKEN_INVALID" });
    expect(provider).not.toHaveBeenCalled();

    const [first, second] = await Promise.all([app.liveFeed(), app.liveFeed()]);
    const live = PriorityFeedSchema.parse(first.json());
    expect(live).toEqual(second.json());
    expect(live.source).toBe("llm");
    expect(live.descriptions).toContainEqual(expect.objectContaining({
      incidentId: "NO-FEED", text: "Поиск периодически работает медленнее.",
    }));
    expect(live.recommendations.some(({ incidentId }) => incidentId === "NO-FEED")).toBe(false);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(await app.liveFeed().then((response) => response.json())).toEqual(live);

    app.setTime(at(5));
    const afterDeadline = PriorityFeedSchema.parse((await app.liveFeed()).json());
    expect(afterDeadline.revision).toBe(live.revision);
    expect(afterDeadline.recommendations).toContainEqual(expect.objectContaining({
      incidentId: "NEAR", sla: "overdue", target: "overdue", reason: expect.stringContaining("Срок SLA истёк"),
    }));
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("uses grounded model evidence even when simple text rules miss the impact", async () => {
    const incidents = [
      { ...template, id: "HIGH" },
      { ...template, id: "LOW", priorityId: 1, shortDescription: "Операция оплаты завершается ошибкой на каждом терминале." },
    ];
    const provider = mockProvider((entries) => providerResponse(modelRows(entries).map((item) =>
      item.id === "LOW" ? { ...item, blockedEvidence: entries[1]!.symptom, widespreadEvidence: entries[1]!.symptom } : item)));
    const app = await setup(incidents);
    expect(PriorityFeedSchema.parse((await app.post()).json()).recommendations.map(({ incidentId }) => incidentId)).toEqual(["HIGH"]);
    expect(PriorityFeedSchema.parse((await app.liveFeed()).json()).recommendations.map(({ incidentId }) => incidentId)).toEqual(["LOW", "HIGH"]);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(["foreign", "duplicate", "wrong-version", "unsupported-evidence", "offline"])(
    "falls back to accepted facts on %s",
    async (badOutput) => {
      const provider = mockProvider((entries) => {
        if (badOutput === "offline") return new Response("offline", { status: 503 });
        const items = modelRows(entries);
        const changes = {
          foreign: { id: "FOREIGN" },
          duplicate: { id: items[1]!.id, version: items[1]!.version },
          "wrong-version": { version: "OLD" },
          "unsupported-evidence": { blockedEvidence: "Вымышленная причина." },
        };
        items[0] = { ...items[0]!, ...changes[badOutput as keyof typeof changes], description: "Непригодное описание." };
        return providerResponse(items);
      });
      const app = await setup(rows.slice(0, 3));
      const feed = PriorityFeedSchema.parse((await app.liveFeed()).json());
      expect(feed.source).toBe("rules");
      expect(feed.fallback).toBe(badOutput === "offline" ? "provider_error" : "invalid_output");
      expect(feed.descriptions.every(({ text }) => text === NO_INCIDENT_DESCRIPTION)).toBe(true);
      app.setTime(at(5));
      const overdue = PriorityFeedSchema.parse((await app.liveFeed()).json());
      expect(overdue.recommendations.find(({ incidentId }) => incidentId === "NEAR")?.sla).toBe("overdue");
      expect(overdue.fallback).toBe(feed.fallback);
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  it("drops a pending response after a version change or reset and reuses unaffected descriptions", async () => {
    let block = false;
    const hold = mockProvider(async (entries, signal) => {
      if (block) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      return providerResponse(modelRows(entries));
    });
    const app = await setup([rows[0], rows.at(-1)]);
    const first = PriorityFeedSchema.parse((await app.liveFeed()).json());
    expect(hold).toHaveBeenCalledTimes(1);
    const latest = { ...rows.at(-1), shortDescription: "Все кассы не могут провести платёж." };
    await app.update([rows[0], latest]);
    block = true;
    const pending = app.liveFeed();
    await expect.poll(() => hold.mock.calls.length).toBe(2);
    block = false;
    const newest = { ...latest, shortDescription: "Оплата недоступна во всех кассах." };
    await app.update([rows[0], newest]);
    expect((await pending).statusCode).toBe(409);

    const current = PriorityFeedSchema.parse((await app.liveFeed()).json());
    expect(current.descriptions).toContainEqual(expect.objectContaining({
      incidentId: "FAR-IMPACT", text: newest.shortDescription,
    }));
    const requestBody = JSON.parse(String(hold.mock.calls[2]![1].body));
    expect(requestBody.input).toContain(newest.shortDescription);
    expect(requestBody.input).not.toContain('"id":"OVERDUE"');

    block = true;
    await app.update([rows[0], latest]);
    const pendingReset = app.liveFeed();
    await expect.poll(() => hold.mock.calls.length).toBe(4);
    block = false;
    await app.runtime.resetTo(bytes([rows[0], rows.at(-1)]));
    expect((await pendingReset).statusCode).toBe(409);
    const reset = PriorityFeedSchema.parse((await app.liveFeed()).json());
    expect(reset.resetSequence).not.toBeNull();
    expect(reset.descriptions).toEqual(first.descriptions);
    expect(hold).toHaveBeenCalledTimes(5);
  });

  it("returns an empty response without a provider request", async () => {
    const provider = mockProvider((entries) => providerResponse(modelRows(entries)));
    const app = await setup([]);
    expect(PriorityFeedSchema.parse((await app.liveFeed()).json())).toMatchObject({
      source: "rules", recommendations: [], descriptions: [],
    });
    expect(provider).not.toHaveBeenCalled();
  });
});
