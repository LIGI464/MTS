import type { Notice, Snapshot } from "@mts/contracts";

export type ActivityEvent = {
  key: string;
  kind: Notice["kind"] | "incident.new";
  incidentId: string | null;
  title: string | null;
  at: string;
};

export type IncidentAlert = {
  sequence: number;
  incidentIds: ReadonlySet<string>;
  eventKeys: ReadonlySet<string>;
};

export type ActivityState = {
  snapshot: Snapshot | null;
  knownIds: ReadonlySet<string> | null;
  noticeWatermark: number;
  addedEvents: ActivityEvent[];
  unread: ReadonlySet<string>;
  alert: IncidentAlert | null;
  sequence: number;
};

const EVENT_LIMIT = 50;

export function createActivityState(): ActivityState {
  return {
    snapshot: null,
    knownIds: null,
    noticeWatermark: -1,
    addedEvents: [],
    unread: new Set(),
    alert: null,
    sequence: 0,
  };
}

export function updateActivity(
  state: ActivityState,
  snapshot: Snapshot,
  liveNotices: readonly Notice[],
): ActivityState {
  if (state.snapshot === snapshot) return state;

  const hasBaseline = state.snapshot !== null;
  const incoming = new Map([...snapshot.notices, ...liveNotices].map((notice) => [notice.seq, notice]));
  const fresh = hasBaseline ? [...incoming.values()].filter((notice) => notice.seq > state.noticeWatermark) : [];
  const reset = fresh.some((notice) => notice.kind === "demo.reset");
  const healthy = snapshot.source.status === "ok";
  const knownIds = healthy ? new Set(snapshot.incidents.map(({ id }) => id)) : state.knownIds;
  const critical = fresh.filter((notice): notice is Notice & { incidentId: string } =>
    notice.kind === "critical.new" && notice.incidentId !== null,
  );
  const criticalIds = new Set(critical.map(({ incidentId }) => incidentId));
  const previouslyKnown = state.knownIds;
  const added = healthy && previouslyKnown && !reset
    ? [...new Map(snapshot.incidents.map((incident) => [incident.id, incident])).values()].filter(({ id }) => !previouslyKnown.has(id))
    : [];
  const addedEvents = added.filter(({ id }) => !criticalIds.has(id)).map(({ id, title }): ActivityEvent => ({
    key: `added:${snapshot.revision}:${id}`,
    kind: "incident.new",
    incidentId: id,
    title,
    at: snapshot.serverNow,
  }));
  const incidentIds = new Set([...criticalIds, ...added.map(({ id }) => id)]);
  const hasAlert = incidentIds.size > 0 && !reset;
  const sequence = state.sequence + Number(hasAlert);
  const eventKeys = new Set([
    ...critical.map(({ seq }) => `notice:${seq}`),
    ...addedEvents.map(({ key }) => key),
  ]);

  const next: ActivityState = {
    snapshot,
    knownIds,
    noticeWatermark: Math.max(
      state.noticeWatermark,
      ...fresh.map(({ seq }) => seq),
      ...snapshot.notices.map(({ seq }) => seq),
    ),
    addedEvents: reset ? [] : [...addedEvents, ...state.addedEvents].slice(0, EVENT_LIMIT),
    alert: reset ? null : hasAlert ? { sequence, incidentIds, eventKeys } : state.alert,
    sequence,
    unread: new Set([
      ...(reset ? [] : state.unread),
      ...fresh.map(({ seq }) => `notice:${seq}`),
      ...addedEvents.map(({ key }) => key),
    ]),
  };
  const visibleUnread = activityEvents(next).filter(({ key }) => next.unread.has(key));
  return { ...next, unread: new Set(visibleUnread.map(({ key }) => key)) };
}

export function activityEvents(state: ActivityState): ActivityEvent[] {
  const fromServer = (state.snapshot?.notices ?? [])
    .toReversed()
    .map((notice) => ({ ...notice, key: `notice:${notice.seq}` }));

  const unique = new Map([...fromServer, ...state.addedEvents].map((event) => [event.key, event]));
  return [...unique.values()].sort((first, second) => second.at.localeCompare(first.at)).slice(0, EVENT_LIMIT);
}
