import type { Notice, Snapshot } from "@mts/contracts";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { activityEvents, createActivityState, updateActivity } from "./activity";

const HIGHLIGHT_MS = 2500;

export function useIncidentAlerts(snapshot: Snapshot | null, liveNotices: readonly Notice[]) {
  const [activity, accept] = useReducer(
    (state: ReturnType<typeof createActivityState>, input: { snapshot: Snapshot; liveNotices: readonly Notice[] } | "read") =>
      input === "read" ? { ...state, unread: new Set<string>() } : updateActivity(state, input.snapshot, input.liveNotices),
    undefined,
    createActivityState,
  );
  const [expired, setExpired] = useState(0);
  const alert = activity.alert;

  useEffect(() => {
    if (snapshot) accept({ snapshot, liveNotices });
  }, [snapshot, liveNotices]);

  useEffect(() => {
    if (!alert) return;
    const timeout = window.setTimeout(() => setExpired(alert.sequence), HIGHLIGHT_MS);
    return () => window.clearTimeout(timeout);
  }, [alert]);

  const events = useMemo(() => activityEvents(activity), [activity]);
  const markRead = useCallback(() => accept("read"), []);
  return { events, alert, unreadCount: activity.unread.size, markRead, highlight: alert && alert.sequence !== expired ? alert : null };
}
