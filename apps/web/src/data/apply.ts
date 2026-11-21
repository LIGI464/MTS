import type { Notice, Snapshot } from "@mts/contracts";

export type FrameOrigin = "get" | "sse" | "reset";

export type ClientFrameState = {
  snapshot: Snapshot | null;
  sawSse: boolean;
  watermark: number | null;
  seen: number[];
  dismissed: number[];
  visible: Notice[];
};

export function createClientFrameState(): ClientFrameState {
  return {
    snapshot: null,
    sawSse: false,
    watermark: null,
    seen: [],
    dismissed: [],
    visible: [],
  };
}

export function applyFrame(state: ClientFrameState, incoming: Snapshot, origin: FrameOrigin): ClientFrameState {
  if (state.snapshot && (
    incoming.revision < state.snapshot.revision ||
    (origin === "get" && state.sawSse && incoming.revision === state.snapshot.revision)
  )) {
    return state;
  }

  const sawSse = state.sawSse || origin === "sse";
  if (origin === "reset") return applyReset(state, incoming, sawSse);
  if (state.watermark === null) return baseline(state, incoming, sawSse);
  return mergeFrame(state, incoming, sawSse);
}

export function dismissFrameNotice(state: ClientFrameState, seq: number): ClientFrameState {
  return {
    ...state,
    dismissed: state.dismissed.includes(seq) ? state.dismissed : [...state.dismissed, seq],
    visible: state.visible.filter((notice) => notice.seq !== seq),
  };
}

function applyReset(state: ClientFrameState, incoming: Snapshot, sawSse: boolean): ClientFrameState {
  const visible = incoming.notices.filter(
    (notice) => notice.kind === "demo.reset" && !state.dismissed.includes(notice.seq),
  );
  const watermark =
    state.watermark ?? maxSeq(incoming.notices.filter((notice) => notice.kind !== "demo.reset"));
  return {
    snapshot: incoming,
    sawSse,
    watermark,
    seen: unique([...state.seen, ...incoming.notices.map((notice) => notice.seq)]),
    dismissed: state.dismissed,
    visible,
  };
}

function baseline(state: ClientFrameState, incoming: Snapshot, sawSse: boolean): ClientFrameState {
  return {
    snapshot: incoming,
    sawSse,
    watermark: maxSeq(incoming.notices),
    seen: incoming.notices.map((notice) => notice.seq),
    dismissed: state.dismissed,
    visible: [],
  };
}

function mergeFrame(state: ClientFrameState, incoming: Snapshot, sawSse: boolean): ClientFrameState {
  const watermark = state.watermark ?? 0;
  const fresh = incoming.notices.filter(
    (notice) => notice.seq > watermark && !state.seen.includes(notice.seq) && !state.dismissed.includes(notice.seq),
  );
  const visible = new Map<number, Notice>();
  for (const notice of state.visible) {
    if (!state.dismissed.includes(notice.seq)) visible.set(notice.seq, notice);
  }
  for (const notice of fresh) visible.set(notice.seq, notice);
  return {
    snapshot: incoming,
    sawSse,
    watermark,
    seen: unique([...state.seen, ...fresh.map((notice) => notice.seq)]),
    dismissed: state.dismissed,
    visible: [...visible.values()].sort((left, right) => left.seq - right.seq),
  };
}

function maxSeq(notices: readonly Notice[]): number {
  return notices.reduce((max, notice) => Math.max(max, notice.seq), 0);
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}
