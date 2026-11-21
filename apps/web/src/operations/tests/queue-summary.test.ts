import { COORDINATOR_TEAM } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { createIncidentFixtures } from "../../data/incident-fixtures";
import { buildQueues, DEFAULT_FILTERS, filterIncidents, matchesRawFilters } from "../queue-summary";

const now = Date.parse("2026-11-21T10:00:00.000Z");
const { initial } = createIncidentFixtures(now);

describe("фильтры и счётчики пульта", () => {
  it("считает 24 активных, 44 записи всего и 5 Research по уникальным ID", () => {
    const incidents = [...initial.incidents, ...initial.incidents];
    const queues = buildQueues(incidents, initial.groups, now);
    expect(queues.high.length + queues.medium.length + queues.low.length + queues.critical.length).toBe(24);
    expect(filterIncidents(incidents, DEFAULT_FILTERS, now)).toHaveLength(24);
    expect(filterIncidents(incidents, { ...DEFAULT_FILTERS, status: "all" }, now)).toHaveLength(44);
    expect(filterIncidents(incidents, { ...DEFAULT_FILTERS, status: "Research" }, now)).toHaveLength(5);
    const byPriority = [1, 2, 3, 4].map((priority) => initial.incidents.filter((item) => item.priority === priority).length);
    expect(byPriority).toEqual([16, 23, 5, 0]);
  });

  it("uses snapshot membership for coordinators and moves a deadline once without affecting its priority queue", () => {
    const [base] = initial.incidents;
    const near = { ...base, id: "near", team: COORDINATOR_TEAM, coordinator: null, dueAt: new Date(now + 60_000).toISOString() };
    const research = { ...near, id: "research", state: "Research" as const };
    const incidents = [near, research, near];
    const groups = { critical: [], coordinator: [near.id, research.id, near.id, "missing"] };
    const coordinatorIds = new Set(groups.coordinator);
    const first = buildQueues(incidents, groups, now);
    expect(first.coordinator).toEqual([near, research]);
    expect(first.high).toEqual([near]);
    expect(first.near).toEqual([near]);
    expect(first.overdue).toEqual([]);
    expect(filterIncidents(incidents, DEFAULT_FILTERS, now, coordinatorIds)).toEqual([near, research]);
    expect(filterIncidents(incidents, { ...DEFAULT_FILTERS, status: "active" }, now, coordinatorIds)).toEqual([near]);

    const later = buildQueues(incidents, groups, now + 60_000);
    expect(later.near).toEqual([]);
    expect(later.overdue).toEqual([near]);
    expect(later.high).toEqual(first.high);
    expect(later.coordinator).toEqual(first.coordinator);
  });

  it("сочетает период по Москве, поиск по сервису, присутствие координатора и SLA", () => {
    const [incident] = initial.incidents;
    const matching = { ...incident, createdAt: "2026-11-20T22:30:00.000Z", dueAt: "2026-11-21T10:10:00.000Z" };
    const other = { ...matching, id: "INC-OTHER", dueAt: null, coordinator: { id: "test", name: "Тест" } };
    expect(filterIncidents([matching, other], {
      ...DEFAULT_FILTERS,
      search: "АВТОРИЗАЦИЯ",
      sla: ["near", "noDeadline"],
      coordinatorPresence: ["unassigned"],
      dateFrom: "2026-11-21",
      dateTo: "2026-11-21",
    }, now)).toEqual([matching]);
  });

  it("проверяет оба поля исходной записи", () => {
    const filters = { ...DEFAULT_FILTERS, duplicates: "yes", consequences: "no" } as const;
    expect(matchesRawFilters({ duplicateOf: "INC0007", eliminationOfConsequences: false }, filters)).toBe(true);
    expect(matchesRawFilters({ isDuplicate: false, eliminationOfConsequences: null }, filters)).toBe(false);
    expect(matchesRawFilters({ isDuplicate: true, eliminationOfConsequences: true }, filters)).toBe(false);
  });
});
