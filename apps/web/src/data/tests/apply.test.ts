import { makeMockTimeline, type Snapshot } from "@mts/contracts";
import { describe, expect, it } from "vitest";
import { applyFrame, createClientFrameState, dismissFrameNotice } from "../apply";
import { errorFromBody } from "../api";

const nowMs = Date.parse("2026-01-15T09:00:00.000Z");
const timeline = makeMockTimeline(nowMs);

function withSource(snapshot: Snapshot, status: Snapshot["source"]["status"]): Snapshot {
  return { ...snapshot, source: { status, lastGoodAt: snapshot.source.lastGoodAt } };
}

describe("applyFrame", () => {
  it("ignores a late GET that is not newer than the SSE snapshot", () => {
    let state = applyFrame(createClientFrameState(), timeline.frames.critical, "sse");
    state = applyFrame(state, timeline.initial, "get");
    expect(state.snapshot?.revision).toBe(timeline.frames.critical.revision);
    const newer = applyFrame(state, timeline.frames.assign, "get");
    expect(newer.snapshot?.revision).toBe(timeline.frames.assign.revision);
  });

  it("does not toast the same notice twice when the SSE frame repeats", () => {
    let state = applyFrame(createClientFrameState(), timeline.initial, "get");
    state = applyFrame(state, timeline.frames.critical, "sse");
    const repeated = applyFrame(state, timeline.frames.critical, "sse");
    expect(repeated.visible.map((notice) => notice.seq)).toEqual(state.visible.map((notice) => notice.seq));
    expect(repeated.visible).toHaveLength(1);
  });

  it("keeps only the reset notice and drops earlier toasts", () => {
    let state = applyFrame(createClientFrameState(), timeline.initial, "get");
    state = applyFrame(state, timeline.frames.resolve, "sse");
    expect(state.visible.map((notice) => notice.kind)).toEqual([
      "critical.new",
      "coordinator.assigned",
      "critical.resolved",
    ]);
    const reset = withSource(timeline.initial, "ok");
    const next = applyFrame(state, {
      ...reset,
      revision: 6,
      notices: [
        {
          seq: 4,
          kind: "demo.reset",
          incidentId: null,
          title: "Набор восстановлен",
          at: reset.serverNow,
        },
      ],
    }, "reset");
    expect(next.visible.map((notice) => notice.kind)).toEqual(["demo.reset"]);
    expect(next.watermark).toBe(state.watermark);
  });

  it("lets the same revision change the source status", () => {
    let state = applyFrame(createClientFrameState(), timeline.initial, "get");
    state = applyFrame(state, withSource(timeline.initial, "stale"), "get");
    expect(state.snapshot?.revision).toBe(timeline.initial.revision);
    expect(state.snapshot?.source.status).toBe("stale");
    state = applyFrame(state, withSource(timeline.initial, "unavailable"), "sse");
    expect(state.snapshot?.source.status).toBe("unavailable");
    const ignored = applyFrame(state, withSource(timeline.initial, "ok"), "get");
    expect(ignored.snapshot?.source.status).toBe("unavailable");
  });

  it("dismisses a toast without moving the watermark or restoring it", () => {
    let state = applyFrame(createClientFrameState(), timeline.initial, "get");
    const watermark = state.watermark;
    state = applyFrame(state, timeline.frames.critical, "sse");
    state = dismissFrameNotice(state, state.visible[0].seq);
    expect(state.visible).toEqual([]);
    expect(state.watermark).toBe(watermark);
    const repeated = applyFrame(state, timeline.frames.critical, "sse");
    expect(repeated.visible).toEqual([]);
  });

  it("walks critical, assign, deadline and resolve without an API", () => {
    let state = applyFrame(createClientFrameState(), timeline.initial, "get");
    expect(state.visible).toEqual([]);
    state = applyFrame(state, timeline.frames.critical, "sse");
    expect(state.visible.map((notice) => notice.kind)).toEqual(["critical.new"]);
    expect(state.snapshot?.groups.critical).toEqual(["INC000000000001"]);
    state = applyFrame(state, timeline.frames.assign, "sse");
    expect(state.visible.map((notice) => notice.kind)).toEqual(["critical.new", "coordinator.assigned"]);
    expect(state.snapshot?.groups.critical).toContain("INC000000000001");
    expect(state.snapshot?.groups.coordinator).toContain("INC000000000001");
    state = applyFrame(state, timeline.frames.deadline, "sse");
    expect(state.visible.map((notice) => notice.seq)).toEqual([1, 2]);
    state = applyFrame(state, timeline.frames.resolve, "sse");
    expect(state.visible.map((notice) => notice.kind)).toEqual([
      "critical.new",
      "coordinator.assigned",
      "critical.resolved",
    ]);
    expect(state.snapshot?.groups.critical).not.toContain("INC000000000001");
    expect(state.snapshot?.groups.coordinator).not.toContain("INC000000000001");
  });
});

describe("errorFromBody", () => {
  it("uses the API message and falls back to a local one", () => {
    expect(errorFromBody({ code: "OPERATOR_TOKEN_INVALID", message: "Токен отклонён" }, "локально").message).toBe(
      "Токен отклонён",
    );
    expect(errorFromBody({ unexpected: true }, "Не удалось выполнить запрос").code).toBe("REQUEST_FAILED");
  });
});
