import type { Snapshot } from "@mts/contracts";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { attentionByQueue, createActivityState, updateActivity, viewAttention, type ActivityState } from "./activity";

type Action =
  | { type: "snapshot"; snapshot: Snapshot; nowMs: number }
  | { type: "view"; key: string }
  | { type: "read-journal" };

function reduce(state: ActivityState, action: Action): ActivityState {
  switch (action.type) {
    case "snapshot": return updateActivity(state, action.snapshot, action.nowMs);
    case "view": return viewAttention(state, action.key);
    case "read-journal": return { ...state, journalUnread: new Set() };
  }
}

export function useIncidentAlerts(snapshot: Snapshot | null, nowMs: number) {
  const [activity, dispatch] = useReducer(reduce, undefined, createActivityState);
  useEffect(() => {
    if (snapshot) dispatch({ type: "snapshot", snapshot, nowMs });
  }, [snapshot, nowMs]);

  const queues = useMemo(() => attentionByQueue(activity.pending), [activity.pending]);
  const markJournalRead = useCallback(() => dispatch({ type: "read-journal" }), []);
  const markViewed = useCallback((key: string) => dispatch({ type: "view", key }), []);
  return { ...activity, queues, markJournalRead, markViewed };
}
