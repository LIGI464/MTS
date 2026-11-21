import type { Incident } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { formatDuration, formatMoscow, presentSla } from "../format";

const minute = 60_000;
const hour = 60 * minute;

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "INC-TEST",
    version: "version",
    title: "Тест",
    product: "Продукт",
    service: "Сервис",
    team: "Команда",
    assignee: "Исполнитель",
    state: "Assigned",
    stateLabel: "Назначен",
    priority: 2,
    urgency: 1,
    impact: 1,
    createdAt: new Date(0).toISOString(),
    dueAt: new Date(4 * hour).toISOString(),
    resolvedAt: null,
    summary: null,
    itsmUrl: null,
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("marks a negative duration", () => {
    expect(formatDuration(-90_000)).toBe("−1 мин");
    expect(formatDuration(-hour)).toBe("−1 ч 00 мин");
  });

  it("treats zero as the boundary", () => {
    expect(formatDuration(0)).toBe("0 мин");
  });

  it("prints hours and padded minutes", () => {
    expect(formatDuration(hour + 5 * minute)).toBe("1 ч 05 мин");
  });

  it("prints whole days and leftover hours", () => {
    expect(formatDuration(2 * 24 * hour + 3 * hour)).toBe("2 д 3 ч");
  });
});

describe("presentSla", () => {
  it("says the deadline is missing", () => {
    expect(presentSla(incident({ dueAt: null }), 0).status).toBe("Срок не задан");
  });

  it("becomes overdue at the deadline and before it stays in time", () => {
    const current = incident();
    expect(presentSla(current, hour).status).toBe("В сроке");
    expect(presentSla(current, hour).duration).toBe("3 ч 00 мин");
    expect(presentSla(current, 4 * hour).status).toBe("Просрочен");
    expect(presentSla(current, 4 * hour).duration).toBe("0 мин");
    expect(presentSla(current, 5 * hour).duration).toBe("−1 ч 00 мин");
  });

  it("labels a near deadline in words and keeps the remaining time", () => {
    const now = Date.parse("2026-01-15T12:00:00.000Z");
    const current = incident({
      createdAt: new Date(now - 100 * minute).toISOString(),
      dueAt: new Date(now + 10 * minute).toISOString(),
    });
    const view = presentSla(current, now);
    expect(view.status).toBe("Срок близко");
    expect(view.duration).toBe("10 мин");
    expect(view.tone).toBe("near");
  });

  it("shows research as solved with the completion time", () => {
    const resolvedAt = "2026-01-15T09:00:00.000Z";
    const view = presentSla(
      incident({ state: "Research", stateLabel: "Исследование ситуации", dueAt: null, resolvedAt }),
      Date.parse(resolvedAt),
    );
    expect(view.status.startsWith("Решён · исследование")).toBe(true);
    expect(view.status).toContain(formatMoscow(resolvedAt));
  });
});
