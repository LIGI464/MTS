import { COORDINATOR_TEAM, makeMockTimeline, type Incident } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../activity";
import { buildQueues } from "../queue-summary";
import { createShiftHandoff } from "../shift-handoff";
import { countTeamWorkload, findIncidentClusters } from "../shift-triage";

const now = Date.parse("2026-11-21T20:00:00.000Z");
const offset = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const base = makeMockTimeline(now).initial.incidents[0];

function incident(id: string, patch: Partial<Incident> = {}): Incident {
  return { ...base, createdAt: offset(-120), id, ...patch };
}

describe("Разбор смены", () => {
  it("группирует совпадения по нормализованным полям и ограничивает интервал первой заявкой", () => {
    const incidents = [
      incident("A", { title: "Сбой   ёмкости!", createdAt: offset(-210) }),
      incident("B", { title: "сбой емкости", createdAt: offset(-120), priority: 4 }),
      incident("B", { title: "сбой емкости", createdAt: offset(-120), priority: 4 }),
      incident("C", { title: "Сбой емкости", createdAt: offset(-119) }),
      incident("D", { title: "Сбой емкости", createdAt: offset(-90), state: "Research" }),
      incident("E", { title: "Сбой емкости", service: "Другой сервис", createdAt: offset(-110) }),
      incident("F", { title: "Сбой емкости", product: "Другой продукт", createdAt: offset(-110) }),
      incident("G", { title: "Сбой емкости", product: null, service: null }),
      incident("H", { title: "Сбой емкости", product: null, service: null }),
    ];
    expect(findIncidentClusters(incidents.toReversed()).map((cluster) => [
      cluster.id, cluster.priority, cluster.incidents.map(({ id }) => id),
    ])).toEqual([["A", 4, ["A", "B"]]]);
  });

  it("принимает один заполненный признак области и сортирует группы по максимальному приоритету", () => {
    const incidents = [
      incident("A", { title: "Один сигнал", product: null }),
      incident("B", { title: "Один сигнал", product: null }),
      incident("C", { title: "Другой сигнал", service: null }),
      incident("D", { title: "Другой сигнал", service: null, priority: 4 }),
    ];
    expect(findIncidentClusters(incidents).map(({ id }) => id)).toEqual(["C", "A"]);
  });

  it("считает фактическую очередь и использует те же границы SLA, что и дашборд", () => {
    const incidents = [
      incident("A", { dueAt: offset(0) }),
      incident("B", { dueAt: offset(15) }),
      incident("B", { dueAt: offset(15) }),
      incident("C", { dueAt: null }),
      incident("D", { dueAt: offset(-30), state: "Closed" }),
      incident("E", { dueAt: offset(-20), team: "Чужая команда" }),
    ];
    expect(countTeamWorkload(incidents, base.team!, now)).toEqual({
      team: base.team, active: 3, overdue: 1, near: 1,
    });
  });
});

describe("Передача смены", () => {
  it("дедуплицирует рабочие очереди, сохраняет причины и ограничивает длину списков", () => {
    const critical = incident("RED", { dueAt: offset(-1), team: COORDINATOR_TEAM, priority: 4 });
    const incidents = [
      ...Array.from({ length: 11 }, (_, index) => incident(`LOW-${index}`, { dueAt: offset(-20 + index) })),
      critical,
      incident("DONE", { dueAt: offset(-50), state: "Resolved", priority: 4 }),
    ];
    const events: ActivityEvent[] = Array.from({ length: 7 }, (_, index) => ({
      key: String(index), at: offset(-index), kind: "incident.new", title: `Событие ${index}`, incidentId: null,
    }));
    const report = createShiftHandoff({
      source: { status: "stale", lastGoodAt: offset(-10) }, sourceLabel: "Источник устарел",
      revision: 7, nowMs: now, queues: buildQueues(incidents, { critical: [critical.id], coordinator: [critical.id] }, now),
      clusters: findIncidentClusters(incidents), events,
    });
    const actionList = report.split("Возможные общие сбои")[0];
    expect(actionList.match(/• RED /g)).toHaveLength(1);
    expect(actionList).toContain("Критические, Просрочены, У координаторов");
    expect(actionList).toContain("Требуют внимания (12)");
    expect(actionList).toContain("Ещё заявок — 2.");
    expect(report).toContain("(+7)");
    expect(report).toContain("Ещё событий в журнале — 2.");
    expect(report).toContain("Источник устарел");
    expect(report).toContain("21.11.2026, 23:00 МСК · ревизия 7");
    expect(report).not.toContain("DONE");
    expect(report).not.toContain("Событие 5");
  });

  it("явно показывает пустое состояние всех разделов", () => {
    const report = createShiftHandoff({
      source: { status: "ok", lastGoodAt: offset(0) }, sourceLabel: "Демонстрационные данные",
      revision: 1, nowMs: now, queues: buildQueues([], { critical: [], coordinator: [] }, now), clusters: [], events: [],
    });
    expect(report).toContain("Демонстрационные данные");
    expect(report).toContain("Нет заявок в этих очередях.");
    expect(report).toContain("Групп совпадений нет.");
    expect(report).toContain("В журнале пока нет событий.");
  });
});
