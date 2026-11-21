import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_PREFIX } from "@mts/contracts";
import { expect, it, vi } from "vitest";
import { findSimilarIncidents, type ArchiveMatchTicket, type SimilarIncidentsResult } from "../src/assistant/matches.js";
import { buildApp } from "../src/http/index.js";
import { atomicWrite } from "../src/source/file.js";
import { createDashboardRuntime } from "../src/source/index.js";
import { LIVE_FILENAME } from "../src/source/input.js";

function matches(result: SimilarIncidentsResult) {
  if (result.kind !== "found") throw new Error(`Expected historical incidents, got ${result.kind}`);
  return result.matches;
}

it("reads completed archive versions and resolves real links after changes and restart", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "mts-d60-"));
  const path = join(dataDir, LIVE_FILENAME);
  const options = {
    dataDir, pollMs: 10, itsmTemplate: "https://itsm.example/incidents/{id}?sysId={sysId}",
    capabilities: { demoReset: true, liveAnalysis: false },
  };
  const subject = {
    id: "SYN-D60/subject", priorityId: 3, stateEnum: "Closed",
    header: "Зависает печать этикеток", description: "Очередь печати ждёт перезапуска",
    productName: "Складской учёт", service: "Печать", submitDate: "2026-05-15T09:30:00.000Z",
  };
  const archived = {
    ...subject, id: "SYN-D60/archive/01", sysId: "00098765432112345678", stateEnum: "Resolved",
    completionDate: "2026-05-15T10:00:00.000Z", shortDescription: "Зависание очереди печати этикеток",
    solution: "Перезапустили службу печати.",
  };
  const closed = { ...subject, id: "SYN-D60/closed" };
  const reopened = { ...archived, id: "SYN-D60/reopened" };
  const other = { ...subject, id: "SYN-D60/other", header: "Пустой отчёт по тарифам", description: null };
  const research = { ...archived, id: "SYN-D60/research", stateEnum: "Research" };
  const active = { ...archived, id: "SYN-D60/active", stateEnum: "WorkInProgress" };
  const query = { incidentId: subject.id };
  let runtime: Awaited<ReturnType<typeof createDashboardRuntime>> | undefined;
  let app: ReturnType<typeof buildApp> | undefined;

  try {
    await atomicWrite(path, Buffer.from(JSON.stringify([subject, archived, closed, reopened, other, research, active])));
    runtime = await createDashboardRuntime(options);
    expect(matches(runtime.findSimilarIncidents(query)).map(({ id }) => id)).toEqual([archived.id, reopened.id, closed.id]);

    const rows = [
      subject, { ...closed, solution: "Очередь восстановили." },
      { ...reopened, stateEnum: "Assigned" }, other, research, active,
    ];
    await atomicWrite(path, Buffer.from(JSON.stringify(rows)));
    const original = runtime;
    await vi.waitFor(() => {
      const found = matches(original.findSimilarIncidents(query));
      expect(found.map(({ id }) => id)).toEqual([archived.id, closed.id]);
      expect(found[0]).toMatchObject({
        id: archived.id, state: "Resolved", present: false, resolvedAt: archived.completionDate,
        symptom: archived.shortDescription, solution: archived.solution,
        href: `https://itsm.example/incidents/${encodeURIComponent(archived.id)}?sysId=${archived.sysId}`,
      });
      expect(found[1]).toMatchObject({
        id: closed.id, state: "Closed", present: true, resolvedAt: null, solution: "Очередь восстановили.",
        href: `/itsm/incidents/${encodeURIComponent(closed.id)}`,
      });
    }, { timeout: 2_000, interval: 10 });

    expect(runtime.findSimilarIncidents({ symptoms: "Найди похожие завершённые инциденты." })).toEqual({ kind: "needs_context" });
    expect(runtime.findSimilarIncidents({ incidentId: "SYN-D60/unknown", symptoms: "печать этикеток" }))
      .toEqual({ kind: "incident_not_found" });
    expect(runtime.findSimilarIncidents({ symptoms: "Не заряжается аккумулятор." })).toEqual({ kind: "no_matches" });
    expect(matches(runtime.findSimilarIncidents({ symptoms: "ЗАВИСАЕТ, печать этикеток!" })).map(({ id }) => id))
      .toEqual([archived.id, closed.id, subject.id]);

    await atomicWrite(path, Buffer.from(JSON.stringify(rows.filter(({ id }) => id !== closed.id))));
    await vi.waitFor(() => {
      expect(matches(original.findSimilarIncidents(query))[1]).toMatchObject({ id: closed.id, present: false });
    }, { timeout: 2_000, interval: 10 });
    const beforeRestart = runtime.findSimilarIncidents(query);

    await runtime.close();
    runtime = await createDashboardRuntime(options);
    const afterRestart = runtime.findSimilarIncidents(query);
    expect(afterRestart).toEqual(beforeRestart);
    app = buildApp({ runtime, dataDir, env: {} });
    const response = await app.inject(`${API_PREFIX}/itsm/incidents/${encodeURIComponent(archived.id)}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ticket: { id: archived.id, present: false, state: "Resolved" },
      solution: archived.solution,
    });
    const local = await app.inject(`${API_PREFIX}${matches(afterRestart)[1].href}`);
    expect(local.statusCode).toBe(200);
    expect(local.json()).toMatchObject({
      ticket: { id: closed.id, present: false, state: "Closed" },
      solution: "Очередь восстановили.",
    });
  } finally {
    if (app) await app.close();
    else await runtime?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

it("counts symptoms separately from product names repeated in a title", () => {
  const subject: ArchiveMatchTicket = {
    id: "SYN-D60/catalog", version: "subject", title: "Сбой — Бирюзовый каталог",
    description: null, shortDescription: null, solution: null,
    state: "Assigned", resolvedAt: null, present: true, product: "Бирюзовый каталог", service: null, sysId: null,
  };
  const archive = {
    getSearchTicket: () => subject,
    completedSearchTickets: (): ArchiveMatchTicket[] => [{
      ...subject, id: "SYN-D60/export", state: "Closed", title: "Бирюзовый каталог: некорректная выгрузка",
    }],
  };
  expect(findSimilarIncidents(archive, { incidentId: subject.id }, () => null)).toEqual({ kind: "no_matches" });
  expect(findSimilarIncidents(archive, { symptoms: "Бирюзовый каталог" }, () => null)).toEqual({ kind: "no_matches" });
  expect(matches(findSimilarIncidents(archive, { symptoms: "Бирюзовый каталог: выгрузка" }, () => null)))
    .toMatchObject([{ id: "SYN-D60/export" }]);
});

it("distinguishes HTTP status codes when searching by symptoms", () => {
  const archive = {
    getSearchTicket: () => null,
    completedSearchTickets: (): ArchiveMatchTicket[] => [404, 500].map((code) => ({
      id: `SYN-D60/http/${code}`, version: "version", title: `Ошибка HTTP ${code}`,
      description: null, shortDescription: null, solution: null,
      state: "Resolved", resolvedAt: null, present: true, product: null, service: null, sysId: null,
    })),
  };
  expect(matches(findSimilarIncidents(archive, { symptoms: "http: 500" }, () => null)).map(({ id }) => id))
    .toEqual(["SYN-D60/http/500"]);
});

it("ranks the best evidence before truncating and breaks ties by completion date then ID", () => {
  const ticket: ArchiveMatchTicket = {
    id: "SYN-D60/subject", version: "subject", title: "Сбой подключения к шлюзу",
    description: "Отказ подключения к шлюзу", shortDescription: null, solution: null,
    state: "Assigned", resolvedAt: null, present: true, product: "Связь", service: "Шлюз", sysId: null,
  };
  const recent = Array.from({ length: 7 }, (_, index): ArchiveMatchTicket => ({
    ...ticket, id: `SYN-D60/${index}`, state: "Closed", product: null, service: null,
    resolvedAt: index === 2 ? "2026-10-10T00:00:00.000Z" : "2026-10-01T00:00:00.000Z",
  }));
  const best: ArchiveMatchTicket = {
    ...ticket, id: "SYN-D60/best", state: "Resolved", resolvedAt: "2025-01-01T00:00:00.000Z",
    solution: " ",
  };
  const archive = {
    getSearchTicket: () => ticket,
    completedSearchTickets: () => [...recent.toReversed(), best],
  };
  const found = matches(findSimilarIncidents(archive, { incidentId: ticket.id }, () => null));
  expect(found.map(({ id }) => id)).toEqual([best.id, recent[2].id, recent[0].id, recent[1].id, recent[3].id]);
  expect(found[0].solution).toBeNull();
});
