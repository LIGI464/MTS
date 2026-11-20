import { IncidentSchema, getSlaState, isActiveState, type Incident } from "@mts/contracts";
import { describe, expect, it } from "vitest";

const minute = 60 * 1000;

function incident(overrides: Partial<Incident> = {}): Incident {
  return IncidentSchema.parse({
    id: "INC000000000010",
    version: "version",
    title: "Заголовок",
    product: null,
    service: null,
    team: null,
    assignee: null,
    state: "Assigned",
    stateLabel: "Назначен",
    priority: 3,
    urgency: null,
    impact: null,
    createdAt: new Date(0).toISOString(),
    dueAt: new Date(100 * minute).toISOString(),
    resolvedAt: null,
    summary: null,
    itsmUrl: null,
    ...overrides,
  });
}

describe("SLA", () => {
  it("marks only assigned and in-progress states as active", () => {
    expect(isActiveState("Assigned")).toBe(true);
    expect(isActiveState("WorkInProgress")).toBe(true);
    expect(isActiveState("Resolved")).toBe(false);
    expect(isActiveState("Closed")).toBe(false);
    expect(isActiveState("Research")).toBe(false);
    expect(isActiveState("Other")).toBe(false);
  });

  it("classifies the near boundary, overdue, and a negative window", () => {
    const current = incident();
    expect(getSlaState(current, 100 * minute - 20 * minute)).toBe("near");
    expect(getSlaState(current, 100 * minute - 20 * minute - 1)).toBe("normal");
    expect(getSlaState(current, 100 * minute)).toBe("overdue");
    expect(getSlaState(current, 100 * minute + 1)).toBe("overdue");

    const reversed = incident({
      createdAt: new Date(100 * minute).toISOString(),
      dueAt: new Date(50 * minute).toISOString(),
    });
    expect(getSlaState(reversed, 40 * minute)).toBe("normal");
    expect(getSlaState(reversed, 50 * minute)).toBe("overdue");
  });

  it("returns unknown without a deadline and done for closed work", () => {
    expect(getSlaState(incident({ dueAt: null }), 0)).toBe("unknown");
    expect(getSlaState(incident({ state: "Other", stateLabel: "Другое", dueAt: null }), 0)).toBe("unknown");
    expect(getSlaState(incident({ state: "Resolved", stateLabel: "Завершен" }), 0)).toBe("done");
    expect(getSlaState(incident({ state: "Closed", stateLabel: "Закрыт" }), 0)).toBe("done");
    expect(getSlaState(incident({ state: "Research", stateLabel: "Исследование ситуации", dueAt: null }), 0)).toBe(
      "done",
    );
  });
});
