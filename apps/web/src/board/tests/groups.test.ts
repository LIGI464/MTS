import { makeMockTimeline } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { cardsForGroup } from "../model";

const nowMs = Date.parse("2026-01-15T09:00:00.000Z");
const criticalId = "INC000000000001";

describe("board groups", () => {
  const timeline = makeMockTimeline(nowMs);

  it("shows the same incident in both groups on assign", () => {
    const assign = timeline.frames.assign;
    const critical = cardsForGroup(assign, "critical").find((card) => card.id === criticalId);
    const coordinator = cardsForGroup(assign, "coordinator").find((card) => card.id === criticalId);
    expect(critical?.incident).toBeTruthy();
    expect(critical?.incident).toBe(coordinator?.incident);
    expect(critical?.incident?.priority).toBe(4);
  });

  it("drops the resolved incident from the active groups", () => {
    const resolved = timeline.frames.resolve;
    expect(cardsForGroup(resolved, "critical").some((card) => card.id === criticalId)).toBe(false);
    expect(cardsForGroup(resolved, "coordinator").some((card) => card.id === criticalId)).toBe(false);
    expect(cardsForGroup(resolved, "high").some((card) => card.id === criticalId)).toBe(false);
    expect(resolved.incidents.find((item) => item.id === criticalId)?.state).toBe("Resolved");
    expect(cardsForGroup(resolved, "research").map((card) => card.id)).toEqual(["INC000000000003"]);
  });

  it("keeps the group slot when the id is missing from the map", () => {
    const snapshot = structuredClone(timeline.initial);
    snapshot.groups.high.push("INC-MISSING");
    const cards = cardsForGroup(snapshot, "high");
    expect(cards.map((card) => card.id)).toContain("INC-MISSING");
    expect(cards.find((card) => card.id === "INC-MISSING")?.incident).toBeNull();
    expect(cards.filter((card) => card.incident).map((card) => card.id)).toEqual(["INC000000000001", "INC000000000002"]);
  });
});
