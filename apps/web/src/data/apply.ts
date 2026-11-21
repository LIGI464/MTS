import type { Snapshot } from "@mts/contracts";

export type FrameOrigin = "get" | "sse" | "reset";

export type ClientFrameState = {
  snapshot: Snapshot | null;
  sawSse: boolean;
};

export function createClientFrameState(): ClientFrameState {
  return { snapshot: null, sawSse: false };
}

export function applyFrame(state: ClientFrameState, incoming: Snapshot, origin: FrameOrigin): ClientFrameState {
  if (state.snapshot && (
    incoming.revision < state.snapshot.revision ||
    (origin === "get" && state.sawSse && incoming.revision === state.snapshot.revision)
  )) {
    return state;
  }
  return { snapshot: incoming, sawSse: state.sawSse || origin === "sse" };
}
