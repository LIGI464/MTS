import { NoticeKindSchema } from "@mts/contracts";
import type { ActivityEvent } from "./activity";

export type ActivityFilter = "" | "pinned" | ActivityEvent["kind"];

export const PIN_STORAGE_PREFIX = "mts:pinned-event:";

export function eventIdentity({ key, kind, incidentId, at }: ActivityEvent): string {
  return JSON.stringify([key, kind, incidentId, at]);
}

export function readPinnedEvents(): Map<string, ActivityEvent> {
  try {
    const storage = window.localStorage;
    const events = new Map<string, ActivityEvent>();
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(PIN_STORAGE_PREFIX)) continue;
      const event = parsePinnedEvent(storage.getItem(key));
      if (!event) continue;
      const identity = eventIdentity(event);
      if (key === PIN_STORAGE_PREFIX + identity) events.set(identity, event);
    }
    return events;
  } catch {
    return new Map();
  }
}

export function storePin(event: ActivityEvent, pinned: boolean): void {
  try {
    const key = PIN_STORAGE_PREFIX + eventIdentity(event);
    if (pinned) window.localStorage.setItem(key, JSON.stringify(event));
    else window.localStorage.removeItem(key);
  } catch {
    // Pins still work in the open tab when storage is unavailable.
  }
}

export function filterActivity(
  events: readonly ActivityEvent[],
  pinned: ReadonlyMap<string, ActivityEvent>,
  filter: ActivityFilter,
): ActivityEvent[] {
  const current = new Map(events.map((event) => [eventIdentity(event), event]));
  const pinnedEvents = Array.from(pinned, ([key, event]) => current.get(key) ?? event)
    .sort((first, second) => second.at.localeCompare(first.at));

  if (filter === "pinned") return pinnedEvents;
  const unpinned = events.filter((event) => !pinned.has(eventIdentity(event)));
  const merged = [...pinnedEvents, ...unpinned];
  return filter ? merged.filter((event) => event.kind === filter) : merged;
}

function parsePinnedEvent(raw: string | null): ActivityEvent | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || !value || !("key" in value) || !("kind" in value)
      || !("incidentId" in value) || !("title" in value) || !("at" in value)) return null;

    const { key, kind, incidentId, title, at } = value;
    if (typeof key !== "string" || (incidentId !== null && typeof incidentId !== "string")
      || (title !== null && typeof title !== "string") || typeof at !== "string"
      || !Number.isFinite(Date.parse(at))) return null;

    if (kind === "incident.new") return { key, kind, incidentId, title, at };
    const noticeKind = NoticeKindSchema.safeParse(kind);
    return noticeKind.success ? { key, kind: noticeKind.data, incidentId, title, at } : null;
  } catch {
    return null;
  }
}
