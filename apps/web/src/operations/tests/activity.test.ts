import { makeMockTimeline, type Notice } from "@mts/contracts";
import { describe, expect, test } from "vitest";
import { activityEvents, createActivityState, updateActivity } from "../activity";
import { filterQueueGroups, summarizeQueues } from "../queue-summary";

const now = Date.UTC(2026, 10, 21, 11);
const timeline = makeMockTimeline(now);

describe("появление инцидентов", () => {
  test("пропускает историю первого снимка и повтор события после переподключения", () => {
    const critical = timeline.frames.critical;
    const baseline = updateActivity(createActivityState(), timeline.initial, []);
    const next = updateActivity(baseline, critical, critical.notices);
    expect(next.alert?.incidentIds.size).toBe(1);
    expect(activityEvents(next).map(({ kind }) => kind)).toEqual(["critical.new"]);

    const replay = updateActivity(next, structuredClone(critical), critical.notices);
    expect(replay.alert).toBe(next.alert);
    expect(activityEvents(replay)).toHaveLength(1);

    const loaded = updateActivity(createActivityState(), critical, critical.notices);
    expect(loaded.alert).toBeNull();
    expect(activityEvents(loaded)).toHaveLength(1);
  });

  test("добавляет обычные инциденты и не дублирует серверное событие о критическом", () => {
    const baseline = updateActivity(createActivityState(), timeline.initial, []);
    const ordinary = { ...timeline.initial.incidents[0], id: "INC-NORMAL", priority: 2 as const };
    const severe = { ...timeline.frames.critical.incidents[0], id: "INC-SEVERE" };
    const notice: Notice = { ...timeline.frames.critical.notices[0], incidentId: severe.id };
    const snapshot = {
      ...timeline.frames.critical,
      incidents: [...timeline.initial.incidents, ordinary, severe],
      notices: [notice],
    };
    const state = updateActivity(baseline, snapshot, snapshot.notices);
    expect(state.alert?.incidentIds).toEqual(new Set([severe.id, ordinary.id]));
    expect(activityEvents(state).map(({ kind }) => kind)).toEqual(["critical.new", "incident.new"]);
  });

  test("восстанавливает штатное состояние после сброса без нового сигнала", () => {
    const baseline = updateActivity(createActivityState(), timeline.initial, []);
    const reset: Notice = { seq: 1, at: new Date(now).toISOString(), kind: "demo.reset", incidentId: null, title: null };
    const snapshot = {
      ...timeline.initial,
      revision: timeline.initial.revision + 1,
      incidents: [...timeline.initial.incidents, { ...timeline.initial.incidents[0], id: "INC-RESTORED" }],
      notices: [reset],
    };
    const state = updateActivity(baseline, snapshot, [reset]);
    expect(state.alert).toBeNull();
    expect(activityEvents(state).map(({ kind }) => kind)).toEqual(["demo.reset"]);
  });
});

test("сводка SLA считает уникальные инциденты и сохраняет пересечения очередей", () => {
  const assign = timeline.frames.assign;
  const result = summarizeQueues(assign, now);
  expect(result.critical.size).toBe(1);
  expect(result.active.size).toBe(2);
  const filtered = filterQueueGroups(assign, result.critical);
  expect(filtered.groups.critical).toEqual(filtered.groups.coordinator);
  expect(filtered.groups.high).toEqual([]);
  expect(filtered.incidents).toBe(assign.incidents);
});
