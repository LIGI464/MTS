import { COORDINATOR_TEAM } from "@mts/contracts";
import type { Incident, Snapshot } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { buildGroups, diffNotices } from "../src/domain/index.js";

const now = "2026-11-20T12:00:00.000Z";
const deadline = "2026-11-20T13:00:00.000Z";

function incident(id: string, overrides: Partial<Incident> = {}): Incident {
  return {
    id,
    version: "version",
    title: id,
    product: null,
    service: null,
    team: null,
    assignee: null,
    state: "Assigned",
    stateLabel: "Назначен",
    priority: 3,
    urgency: null,
    impact: null,
    createdAt: now,
    dueAt: deadline,
    resolvedAt: null,
    summary: null,
    itsmUrl: null,
    ...overrides,
  };
}

function snapshot(incidents: Incident[]): Snapshot {
  return {
    apiVersion: 1,
    revision: 1,
    serverNow: now,
    source: { status: "ok", lastGoodAt: now },
    capabilities: { demoReset: false, liveAnalysis: false },
    incidents,
    groups: buildGroups(incidents),
    notices: [],
  };
}

describe("dashboard groups", () => {
  it("includes critical and research cards independently in the coordinator group", () => {
    expect(buildGroups([
      incident("critical", { priority: 4, team: COORDINATOR_TEAM }),
      incident("research", {
        state: "Research",
        team: COORDINATOR_TEAM,
        dueAt: null,
        resolvedAt: now,
      }),
      incident("closed", { priority: 4, state: "Closed", team: COORDINATOR_TEAM }),
      incident("resolved", { priority: 4, state: "Resolved", team: COORDINATOR_TEAM }),
      incident("high", { state: "WorkInProgress" }),
    ])).toEqual({
      critical: ["critical"],
      coordinator: ["critical", "research"],
      high: ["high"],
      research: ["research"],
    });
  });

  it("sorts by deadline, newest registration, and string ID with null deadlines last", () => {
    const incidents = [
      incident("no-deadline", { dueAt: null }),
      incident("older", { createdAt: "2026-11-19T12:00:00.000Z" }),
      incident("b"),
      incident("first", { dueAt: "2026-11-20T12:30:00.000Z" }),
      incident("a"),
    ];

    expect(buildGroups(incidents).high).toEqual(["first", "a", "b", "older", "no-deadline"]);
    expect(incidents.map(({ id }) => id)).toEqual(["no-deadline", "older", "b", "first", "a"]);
  });
});

describe("dashboard notices", () => {
  const urgent = incident("urgent", { priority: 4, team: COORDINATOR_TEAM });

  it("suppresses initial notices and emits both entries on a membership change", () => {
    const next = snapshot([urgent]);
    expect(diffNotices(null, next, now)).toEqual([]);
    expect(diffNotices(snapshot([]), next, now)).toEqual([
      { kind: "critical.new", incidentId: urgent.id, title: urgent.title, at: now },
      { kind: "coordinator.assigned", incidentId: urgent.id, title: urgent.title, at: now },
    ]);
    expect(diffNotices(next, snapshot([{ ...urgent, assignee: "Оператор" }]), now)).toEqual([]);
  });

  it.each(["Resolved", "Closed", "Research"] as const)("reports a critical transition to %s", (state) => {
    const next = snapshot([{ ...urgent, state }]);
    expect(diffNotices(snapshot([urgent]), next, now)).toEqual([
      { kind: "critical.resolved", incidentId: urgent.id, title: "Критический инцидент решён", at: now },
    ]);
    expect(diffNotices(next, next, now)).toEqual([]);
  });

  it("omits resolution notices for removed or downgraded critical cards", () => {
    const previous = snapshot([urgent]);
    expect(diffNotices(previous, snapshot([]), now)).toEqual([]);
    expect(diffNotices(previous, snapshot([{ ...urgent, priority: 3 }]), now)).toEqual([]);
  });
});
