import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { compareIncidents } from "../board/model";
import type { IncidentAttention } from "./activity";
import { queueId, type QueueCategory, type QueueMembers } from "./queue-summary";

export type QueueLocation = { category: QueueCategory; id: string };
export type QueueTarget = QueueLocation & { attentionKey: string | null };
export type SlaCategory = "near" | "overdue";
type ExactDestination = {
  id: string;
  version: string;
  onArrival: (target: QueueTarget) => void;
  onUnavailable: () => void;
};
type Request = { serial: number; category: QueueCategory; resetSequence: number; destination?: ExactDestination };

const closedSla = { near: false, overdue: false };

function keyOf({ category, id }: QueueLocation): string {
  return JSON.stringify([category, id]);
}

function isSla(category: QueueCategory): category is SlaCategory {
  return category === "near" || category === "overdue";
}

export function useQueueNavigation(
  queues: QueueMembers, full: QueueMembers, pending: readonly IncidentAttention[], resetSequence: number,
) {
  const serial = useRef(0);
  const [request, setRequest] = useState<Request | null>(null);
  const [revealed, setRevealed] = useState<ReadonlyMap<string, QueueLocation>>(() => new Map());
  const [selected, setSelected] = useState<ReadonlyMap<string, QueueTarget>>(() => new Map());
  const [expandedSla, setExpandedSla] = useState(closedSla);

  const cancel = useCallback((clearReveals = false) => {
    serial.current++;
    setRequest(null);
    if (clearReveals) setRevealed(new Map());
  }, []);

  useLayoutEffect(() => {
    cancel(true);
    setSelected(new Map());
    setExpandedSla(closedSla);
  }, [cancel, resetSequence]);

  function jump(category: QueueCategory, destination?: ExactDestination) {
    cancel();
    if (isSla(category)) setExpandedSla({ near: category === "near", overdue: category === "overdue" });
    setRequest({ serial: serial.current, category, resetSequence, destination });
  }

  function toggleSla(category: SlaCategory) {
    cancel();
    setExpandedSla((open) => ({ ...open, [category]: !open[category] }));
  }

  const active = request?.resetSequence === resetSequence ? request : null;
  const category = active?.category;
  const destination = active?.destination;
  const members = category ? full[category] : [];
  const exact = destination && members.find((entry) => entry.id === destination.id && entry.version === destination.version);
  const next = category && pending.find((entry) =>
    entry.categories.includes(category) && (destination ? entry.incidentId === exact?.id :
      members.some(({ id }) => id === entry.incidentId)),
  );
  const id = destination ? exact?.id : (next ? next.incidentId : members[0]?.id);
  const attentionKey = next ? next.key : null;
  const target = category && id ? { category, id } : null;
  const locations = new Map(revealed);
  if (target) locations.set(keyOf(target), target);
  const visible = { ...queues };
  const outside: QueueLocation[] = [];
  for (const location of locations.values()) {
    const { category, id } = location;
    if (visible[category].some((incident) => incident.id === id)) continue;
    const incident = full[category].find((entry) => entry.id === id);
    if (!incident) continue;
    visible[category] = [...visible[category], incident].sort(compareIncidents);
    outside.push(location);
  }
  const needsReveal = Boolean(target && outside.some((location) => keyOf(location) === keyOf(target)));

  useLayoutEffect(() => {
    if (!active || !category) return;
    const region = document.getElementById(queueId(category));
    if (!region) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduce ? "instant" : "smooth";
    const focusHeading = () => {
      const heading = region.querySelector<HTMLElement>("[data-sla-toggle]") ?? region;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start", behavior });
    };
    const card = id ? region.querySelector<HTMLElement>(`[data-incident-id="${CSS.escape(id)}"]`) : null;
    const title = card?.querySelector<HTMLElement>("[data-card-title]");
    if (!id || !title) {
      if (destination) destination.onUnavailable();
      else focusHeading();
      setRequest(null);
      return;
    }

    title.focus({ preventScroll: true });
    title.scrollIntoView({ block: "center", inline: "nearest", behavior });
    const start = performance.now();
    let frame: number;
    let lastTop = -Infinity;
    let still = 0;

    const check = (now: number) => {
      if (serial.current !== active.serial || !title.isConnected) return;
      const top = title.getBoundingClientRect().top;
      still = Math.abs(top - lastTop) < 0.5 ? still + 1 : 0;
      lastTop = top;
      if (!reduce && still < 3 && now - start < 1100) {
        frame = requestAnimationFrame(check);
        return;
      }
      if (!visibleOnScreen(title)) title.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      if (visibleOnScreen(title) && region.contains(title)) {
        const location = { category, id };
        const key = keyOf(location);
        if (needsReveal) setRevealed((previous) => new Map(previous).set(key, location));
        const current = { ...location, attentionKey };
        setSelected((previous) => new Map(previous).set(key, current));
        destination?.onArrival(current);
      } else if (destination) {
        destination.onUnavailable();
      } else {
        focusHeading();
      }
      setRequest(null);
    };

    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [active, category, id, attentionKey, needsReveal, destination]);

  const inspect = useCallback((target: QueueTarget) => {
    setSelected((previous) => {
      const key = keyOf(target);
      if (previous.get(key)?.attentionKey !== target.attentionKey) return previous;
      const next = new Map(previous);
      next.delete(key);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const isCurrent = ({ category, id }: QueueLocation) => full[category].some((entry) => entry.id === id);
    if ([...selected.values()].some((location) => !isCurrent(location))) {
      setSelected(new Map([...selected].filter(([, location]) => isCurrent(location))));
    }
    if ([...revealed.values()].some((location) => !isCurrent(location))) {
      setRevealed(new Map([...revealed].filter(([, location]) => isCurrent(location))));
    }
  }, [full, selected, revealed]);

  return {
    queues: visible,
    revealed: outside,
    target: (category: QueueCategory, id: string) => selected.get(keyOf({ category, id })),
    expandedSla, toggleSla, jump, cancel, inspect,
  };
}

function visibleOnScreen(target: HTMLElement): boolean {
  const box = target.getBoundingClientRect();
  let top = Math.max(box.top, 0);
  let bottom = Math.min(box.bottom, window.innerHeight);
  for (let parent = target.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY === "visible") continue;
    const bounds = parent.getBoundingClientRect();
    top = Math.max(top, bounds.top);
    bottom = Math.min(bottom, bounds.bottom);
  }
  return box.width > 0 && box.height > 0 && bottom - top >= Math.min(box.height, 24) - 1;
}
