import { COORDINATOR_TEAM, makeMockTimeline } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { incidentCoordinator, priorityQueues } from "../model";

const timeline = makeMockTimeline(Date.parse("2026-01-15T09:00:00.000Z"));

describe("priority queues", () => {
  it("uses priority and a single slot per ID, including inactive records", () => {
    const [critical, high, research] = timeline.frames.assign.incidents;
    const low = { ...high, id: "INC-LOW", priority: 1 as const };
    const queued = priorityQueues([critical, high, research, low, critical]);
    expect(queued[4]).toEqual([critical]);
    expect(queued[3]).toEqual([high]);
    expect(queued[2]).toEqual([research]);
    expect(queued[1]).toEqual([low]);
    expect(research.state).toBe("Research");
  });

  it("requires a confirmed coordinator even if a legacy card has an assignee in the coordinator team", () => {
    const [incident] = timeline.initial.incidents;
    expect(incidentCoordinator(incident)).toBeNull();
    const legacy = { ...incident, team: COORDINATOR_TEAM };
    expect(incidentCoordinator(legacy)).toBeNull();
    expect(incidentCoordinator({ ...legacy, coordinator: null })).toBeNull();
    expect(incidentCoordinator({ ...incident, coordinator: { id: "operator", name: "Оператор" } })?.id).toBe("operator");
  });
});
