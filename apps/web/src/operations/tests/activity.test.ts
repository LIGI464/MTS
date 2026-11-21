import { makeMockTimeline, type Incident, type Notice, type Snapshot } from "@mts/contracts";
import { describe, expect, test } from "vitest";
import { attentionByQueue, createActivityState, updateActivity, viewAttention } from "../activity";

const now = Date.UTC(2026, 10, 21, 11);
const at = new Date(now).toISOString();
const timeline = makeMockTimeline(now);
const [base] = timeline.initial.incidents;

function card(id: string, fields: Partial<Incident> = {}): Incident {
  return { ...base, id, dueAt: null, ...fields };
}

function frame(revision: number, incidents: Incident[], changes: Partial<Snapshot> = {}): Snapshot {
  return { ...timeline.initial, revision, incidents, ...changes };
}

function notice(seq: number, revision: number, kind: Notice["kind"], incidentId: string | null): Notice {
  return { seq, revision, kind, incidentId, at, title: null };
}

describe("непросмотренные поступления", () => {
  test("использует пригодный снимок как исходную базу и хранит доступную историю", () => {
    const first = frame(8, [card("old", { priority: 4 })], {
      groups: { ...timeline.initial.groups, critical: ["old"] },
      notices: [notice(10, 8, "critical.new", "old")],
    });
    const state = updateActivity(createActivityState(), first, now);
    expect(state.soundSequence).toBe(0);
    expect(state.pending).toEqual([]);
    expect(state.journalUnread.size).toBe(0);
    expect(state.events).toMatchObject([{ key: "notice:10", kind: "critical.new" }]);
    expect(updateActivity(state, structuredClone(first), now + 1).pending).toEqual([]);
  });

  test("объединяет категории одного поступления и сохраняет следующий сигнал того же ID", () => {
    const before = frame(1, [card("target")]);
    const after = frame(2, [card("target", { priority: 4, dueAt: new Date(now + 60_000).toISOString() })], {
      groups: { ...before.groups, critical: ["target"], coordinator: ["target"] },
      notices: [notice(1, 2, "critical.new", "target"), notice(2, 2, "coordinator.assigned", "target")],
    });
    const first = updateActivity(updateActivity(createActivityState(), before, now), after, now);
    expect(first.soundSequence).toBe(1);
    expect(first.pending).toMatchObject([{
      key: "notice:1", categories: ["critical", "coordinator", "near"], eventKeys: ["notice:1", "notice:2"],
    }]);
    expect(first.events).toHaveLength(2);
    const later = {
      ...after, revision: 3, notices: [...after.notices, notice(3, 3, "coordinator.changed", "target")],
    };
    const second = updateActivity(first, later, now);
    expect(second.soundSequence).toBe(2);
    expect(second.pending.map(({ key }) => key)).toEqual(["notice:3", "notice:1"]);
    expect(attentionByQueue(second.pending).get("coordinator")?.get("target")?.key).toBe("notice:3");
    const viewed = viewAttention(second, "notice:3");
    expect(viewed.pending.map(({ key }) => key)).toEqual(["notice:1"]);
    expect(viewed.journalUnread).toEqual(second.journalUnread);
    const reconnected = updateActivity(viewed, structuredClone(later), now + 1);
    expect(reconnected.pending).toEqual(viewed.pending);
    expect(reconnected.soundSequence).toBe(2);
  });

  test("различает принятые ревизии даже при доставке с одинаковым временем в одном снимке", () => {
    const initial = frame(1, []);
    const state = updateActivity(createActivityState(), initial, now);
    const snapshot = frame(4, [card("target", { priority: 4 })], {
      groups: { ...initial.groups, critical: ["target"], coordinator: ["target"] },
      notices: [
        notice(1, 2, "critical.new", "target"),
        notice(2, 2, "coordinator.assigned", "target"),
        notice(3, 3, "coordinator.changed", "target"),
        notice(4, 4, "coordinator.changed", "outside"),
      ],
    });
    const next = updateActivity(state, snapshot, now);
    expect(next.soundSequence).toBe(3);
    expect(next.pending.map(({ key }) => key)).toEqual(["notice:3", "notice:1"]);
    expect(next.events[0]).toMatchObject({ key: "notice:4" });
  });

  test("создаёт тихий сигнал для каждого приоритета и для повторного входа в SLA", () => {
    const initial = frame(1, []);
    const state = updateActivity(createActivityState(), initial, now);
    const first = frame(2, [
      card("high", { dueAt: new Date(now + 60_000).toISOString() }),
      card("medium", { priority: 2 }),
      card("low", { priority: 1 }),
    ]);
    const arrivals = updateActivity(state, first, now);
    expect(arrivals.soundSequence).toBe(0);
    expect(attentionByQueue(arrivals.pending).get("high")?.get("high")?.categories).toEqual(["high", "near"]);
    expect(attentionByQueue(arrivals.pending).get("medium")?.size).toBe(1);
    expect(attentionByQueue(arrivals.pending).get("low")?.size).toBe(1);
    expect(arrivals.events.map(({ kind }) => kind)).toEqual(["incident.new", "incident.new", "incident.new"]);

    const stale = { ...first, source: { ...first.source, status: "stale" as const } };
    const overdue = updateActivity(arrivals, stale, now + 60_000);
    expect(overdue.soundSequence).toBe(0);
    expect(attentionByQueue(overdue.pending).get("near")).toBeUndefined();
    expect(attentionByQueue(overdue.pending).get("overdue")?.get("high")?.categories).toEqual(["overdue"]);
    expect(overdue.events[0].kind).toBe("sla.overdue");
    expect(updateActivity(overdue, first, now + 61_000).pending).toEqual(overdue.pending);
    const changed = frame(3, [{ ...first.incidents[0], dueAt: new Date(now + 120_000).toISOString() }, ...first.incidents.slice(1)]);
    const nearAgain = updateActivity(overdue, changed, now + 60_000);
    expect(nearAgain.events[0].kind).toBe("sla.near");
    expect(nearAgain.pending[0].key).not.toBe(arrivals.pending.find(({ incidentId }) => incidentId === "high")?.key);
  });

  test("сохраняет непросмотренную цель за пределами журнала и очищает её при сбросе", () => {
    const old = frame(1, []);
    const received = frame(2, [card("target", { priority: 4 })], {
      groups: { ...old.groups, critical: ["target"] },
      notices: [notice(1, 2, "critical.new", "target")],
    });
    const active = updateActivity(updateActivity(createActivityState(), old, now), received, now);
    const many = Array.from({ length: 53 }, (_, index) => notice(index + 2, 3, "critical.resolved", "closed"));
    const filled = updateActivity(active, { ...received, revision: 3, notices: many }, now);
    expect(filled.events).toHaveLength(50);
    expect(filled.events.some(({ key }) => key === "notice:1")).toBe(false);
    expect(filled.pending[0].key).toBe("notice:1");
    expect(filled.soundSequence).toBe(1);
    const reset = frame(4, [card("another")], { notices: [notice(55, 4, "demo.reset", null)] });
    const next = updateActivity(filled, reset, now);
    expect(next.pending).toEqual([]);
    expect(next.events.map(({ kind }) => kind)).toEqual(["demo.reset"]);
    expect(next.soundSequence).toBe(1);
    expect(next.resetSequence).toBe(55);
    expect(updateActivity(next, reset, now).soundSequence).toBe(1);
  });

  test("не объявляет первый принятый набор после недоступного источника", () => {
    const unavailable = frame(0, [], { source: { status: "unavailable", lastGoodAt: null } });
    const waiting = updateActivity(createActivityState(), unavailable, now);
    expect(waiting.revision).toBeNull();
    const next = updateActivity(waiting, frame(1, [card("first")]), now);
    expect(next.pending).toEqual([]);
    expect(next.events).toEqual([]);
    expect(next.soundSequence).toBe(0);
  });
});
