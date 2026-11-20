import {
  COORDINATOR_TEAM,
  SnapshotSchema,
  getSlaState,
  makeMockTimeline,
} from "@mts/contracts";
import { describe, expect, it } from "vitest";

const nowMs = Date.parse("2026-01-15T09:00:00.000Z");
const criticalId = "INC000000000001";
const timerId = "INC000000000002";
const researchId = "INC000000000003";

describe("mock timeline", () => {
  const timeline = makeMockTimeline(nowMs);

  it("publishes revisions 1–5 and a snapshot the client can parse", () => {
    expect(timeline.initial.revision).toBe(1);
    expect(timeline.frames.critical.revision).toBe(2);
    expect(timeline.frames.assign.revision).toBe(3);
    expect(timeline.frames.deadline.revision).toBe(4);
    expect(timeline.frames.resolve.revision).toBe(5);
    expect(SnapshotSchema.parse(timeline.initial)).toBeTruthy();
    for (const frame of Object.values(timeline.frames)) SnapshotSchema.parse(frame);
    expect(timeline.initial.serverNow).toBe(new Date(nowMs).toISOString());
    expect(timeline.initial.notices).toEqual([]);
    expect(timeline.initial.incidents.some((incident) => incident.priority === 4)).toBe(false);
  });

  it("keeps each next frame and shows the critical id in both groups on assign", () => {
    expect(timeline.initial.groups.high).toEqual([criticalId, timerId]);
    expect(timeline.frames.critical.groups.critical).toEqual([criticalId]);
    expect(timeline.frames.critical.groups.high).toEqual([timerId]);
    expect(timeline.frames.assign.groups.critical).toContain(criticalId);
    expect(timeline.frames.assign.groups.coordinator).toContain(criticalId);
    expect(timeline.frames.assign.incidents.find((incident) => incident.id === criticalId)?.team).toBe(
      COORDINATOR_TEAM,
    );
    expect(timeline.frames.assign.incidents.find((incident) => incident.id === criticalId)?.priority).toBe(4);

    const deadlineTimer = timeline.frames.deadline.incidents.find((incident) => incident.id === timerId);
    expect(deadlineTimer?.dueAt).toBe(new Date(nowMs + 90_000).toISOString());
    expect(deadlineTimer ? getSlaState(deadlineTimer, nowMs) : null).toBe("near");
    expect(timeline.frames.deadline.groups.critical).toContain(criticalId);
    expect(timeline.frames.deadline.groups.coordinator).toContain(criticalId);

    expect(timeline.frames.resolve.groups.critical).not.toContain(criticalId);
    expect(timeline.frames.resolve.groups.coordinator).not.toContain(criticalId);
    expect(timeline.frames.resolve.incidents.find((incident) => incident.id === criticalId)?.state).toBe("Resolved");
    expect(timeline.frames.resolve.incidents.find((incident) => incident.id === timerId)?.dueAt).toBe(
      new Date(nowMs + 90_000).toISOString(),
    );
  });

  it("prepares research with a completion time and an empty deadline", () => {
    const research = timeline.initial.incidents.find((incident) => incident.id === researchId);
    expect(research?.state).toBe("Research");
    expect(research?.dueAt).toBeNull();
    expect(research?.resolvedAt).toBeTruthy();
    expect(timeline.initial.groups.research).toEqual([researchId]);
    expect(timeline.frames.resolve.groups.research).toEqual([researchId]);
  });

  it("emits one monotonic notice per entered or resolved state", () => {
    expect(timeline.frames.critical.notices.map((notice) => [notice.seq, notice.kind])).toEqual([
      [1, "critical.new"],
    ]);
    expect(timeline.frames.assign.notices.map((notice) => notice.seq)).toEqual([1, 2]);
    expect(timeline.frames.deadline.notices.map((notice) => notice.seq)).toEqual([1, 2]);
    expect(timeline.frames.resolve.notices.map((notice) => [notice.seq, notice.kind, notice.title])).toEqual([
      [1, "critical.new", "Массовый отказ авторизации"],
      [2, "coordinator.assigned", "Массовый отказ авторизации"],
      [3, "critical.resolved", "Критический инцидент решён"],
    ]);
  });
});
