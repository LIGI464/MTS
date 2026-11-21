import type { Notice, Snapshot } from "@mts/contracts";
import { buildQueues, PRIORITY_QUEUES, SLA_QUEUES, type QueueCategory } from "./queue-summary";

export type ActivityEvent = {
  key: string;
  kind: Notice["kind"] | "incident.new" | "sla.near" | "sla.overdue";
  incidentId: string | null;
  title: string | null;
  at: string;
};

export type IncidentAttention = {
  key: string;
  incidentId: string;
  categories: readonly QueueCategory[];
  eventKeys: readonly string[];
  at: string;
  order: number;
};

type Membership = ReadonlyMap<QueueCategory, ReadonlySet<string>>;

export type ActivityState = {
  revision: number | null;
  knownIds: ReadonlySet<string>;
  membership: Membership;
  noticeWatermark: number;
  resetSequence: number;
  events: ActivityEvent[];
  journalUnread: ReadonlySet<string>;
  pending: IncidentAttention[];
  arrivalOrder: number;
  soundSequence: number;
};

type Arrival = Omit<IncidentAttention, "categories" | "eventKeys"> & {
  categories: Set<QueueCategory>;
  eventKeys: string[];
  revision: number | undefined;
};

const EVENT_LIMIT = 50;

export function createActivityState(): ActivityState {
  return {
    revision: null,
    knownIds: new Set(),
    membership: new Map(),
    noticeWatermark: -1,
    resetSequence: -1,
    events: [],
    journalUnread: new Set(),
    pending: [],
    arrivalOrder: 0,
    soundSequence: 0,
  };
}

function noticeEvent({ seq, kind, incidentId, title, at }: Notice): ActivityEvent {
  return { key: `notice:${seq}`, kind, incidentId, title, at };
}

function recentEvents(events: ActivityEvent[]): ActivityEvent[] {
  return events.sort((left, right) => right.at.localeCompare(left.at)).slice(0, EVENT_LIMIT);
}

function noticeCategory(kind: Notice["kind"]): QueueCategory | null {
  if (kind === "critical.new") return "critical";
  if (kind === "coordinator.assigned" || kind === "coordinator.changed") return "coordinator";
  return null;
}

export function updateActivity(state: ActivityState, snapshot: Snapshot, nowMs: number): ActivityState {
  if (snapshot.source.lastGoodAt === null || (state.revision !== null && snapshot.revision < state.revision)) return state;

  const knownIds = new Set(snapshot.incidents.map(({ id }) => id));
  const queues = buildQueues(snapshot.incidents, snapshot.groups, nowMs);
  const membership: Membership = new Map((Object.keys(queues) as QueueCategory[]).map(
    (category) => [category, new Set(queues[category].map(({ id }) => id))],
  ));
  const fresh = snapshot.notices.filter(({ seq }) => seq > state.noticeWatermark).toSorted((a, b) => a.seq - b.seq);
  const noticeWatermark = Math.max(state.noticeWatermark, ...fresh.map(({ seq }) => seq));
  const reset = fresh.findLast(({ kind }) => kind === "demo.reset");
  const baseline = { revision: snapshot.revision, knownIds, membership, noticeWatermark };

  if (state.revision === null || reset) {
    const events = recentEvents(snapshot.notices.toSorted((a, b) => b.seq - a.seq).map(noticeEvent));
    return {
      ...state, ...baseline, events, pending: [],
      resetSequence: reset?.seq ?? state.resetSequence,
      journalUnread: new Set(reset && state.revision !== null ? [noticeEvent(reset).key] : []),
    };
  }

  let arrivalOrder = state.arrivalOrder;
  const nextEvents = fresh.map(noticeEvent);
  const arrivals = new Map<string, Arrival>();
  const latestByIncident = new Map<string, Arrival>();
  for (const notice of fresh) {
    const category = noticeCategory(notice.kind);
    const incidentId = notice.incidentId;
    if (!category || !incidentId) continue;

    // The server records the accepting revision on each notice from the same transaction.
    const batch = JSON.stringify([notice.revision ?? notice.at, incidentId]);
    let arrival = arrivals.get(batch);
    if (!arrival) {
      arrival = {
        key: noticeEvent(notice).key, incidentId, at: notice.at, order: ++arrivalOrder,
        categories: new Set(), eventKeys: [], revision: notice.revision,
      };
      arrivals.set(batch, arrival);
    }
    arrival.eventKeys.push(noticeEvent(notice).key);
    if (membership.get(category)?.has(incidentId)) arrival.categories.add(category);
    latestByIncident.set(incidentId, arrival);
  }
  const soundSequence = state.soundSequence + arrivals.size;

  for (const { id, title } of new Map(snapshot.incidents.map((incident) => [incident.id, incident])).values()) {
    const added = !state.knownIds.has(id);
    const categories = [
      ...PRIORITY_QUEUES.filter((category) => added && membership.get(category)?.has(id)),
      ...SLA_QUEUES.filter((category) => membership.get(category)?.has(id) && !state.membership.get(category)?.has(id)),
    ];
    if (!added && categories.length === 0) continue;

    const arrival = latestByIncident.get(id);
    if (arrival && (arrival.revision === undefined || arrival.revision === snapshot.revision)) {
      for (const category of categories) arrival.categories.add(category);
      continue;
    }
    if (arrival && categories.length === 0) continue;

    const order = ++arrivalOrder;
    const key = `local:${order}`;
    const at = new Date(nowMs).toISOString();
    const kind = added ? "incident.new" : categories.includes("near") ? "sla.near" : "sla.overdue";
    nextEvents.push({ key, kind, incidentId: id, title, at });
    arrivals.set(key, {
      key, at, order, incidentId: id, categories: new Set(categories), eventKeys: [key], revision: undefined,
    });
  }

  const previous = state.pending.flatMap((entry) => {
    const categories = entry.categories.filter((category) => membership.get(category)?.has(entry.incidentId));
    if (categories.length === 0) return [];
    return categories.length === entry.categories.length ? entry : { ...entry, categories };
  });
  const pending = [...previous, ...Array.from(arrivals.values(), ({ revision: _revision, ...arrival }) => ({
    ...arrival, categories: [...arrival.categories],
  })).filter(({ categories }) => categories.length > 0)]
    .sort((left, right) => right.at.localeCompare(left.at) || right.order - left.order);

  const events = nextEvents.length ? recentEvents([...nextEvents.toReversed(), ...state.events]) : state.events;
  const freshKeys = new Set(nextEvents.map(({ key }) => key));
  const journalUnread = nextEvents.length
    ? new Set(events.filter(({ key }) => state.journalUnread.has(key) || freshKeys.has(key)).map(({ key }) => key))
    : state.journalUnread;
  return { ...state, ...baseline, events, pending, journalUnread, soundSequence, arrivalOrder };
}

export function viewAttention(state: ActivityState, key: string): ActivityState {
  const pending = state.pending.filter((entry) => entry.key !== key);
  return pending.length === state.pending.length ? state : { ...state, pending };
}

export function attentionByQueue(pending: readonly IncidentAttention[]) {
  const queues = new Map<QueueCategory, Map<string, IncidentAttention>>();
  for (const entry of pending) {
    for (const category of entry.categories) {
      let incidents = queues.get(category);
      if (!incidents) {
        incidents = new Map();
        queues.set(category, incidents);
      }
      if (!incidents.has(entry.incidentId)) incidents.set(entry.incidentId, entry);
    }
  }
  return queues;
}
