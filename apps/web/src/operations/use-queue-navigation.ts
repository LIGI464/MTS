import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { compareIncidents } from "../board/model";
import type { IncidentAttention } from "./activity";
import { queueId, type QueueCategory, type QueueMembers } from "./queue-summary";

type Location = { category: QueueCategory; id: string };
type Request = { serial: number; category: QueueCategory; key: string | undefined; resetSequence: number };

const PULSE_MS = 900;

export function useQueueNavigation(
  queues: QueueMembers, full: QueueMembers, pending: readonly IncidentAttention[],
  resetSequence: number, onViewed: (key: string) => void,
) {
  const serial = useRef(0);
  const [request, setRequest] = useState<Request | null>(null);
  const [revealed, setRevealed] = useState<Location | null>(null);
  const [pulse, setPulse] = useState<Location | null>(null);

  const cancel = useCallback(() => {
    serial.current++;
    setRequest(null);
    setRevealed(null);
    setPulse(null);
  }, []);

  useLayoutEffect(() => cancel(), [cancel, resetSequence]);

  function jump(category: QueueCategory) {
    cancel();
    const next = pending.find((entry) =>
      entry.categories.includes(category) && full[category].some(({ id }) => id === entry.incidentId),
    );
    setRequest({ serial: serial.current, category, key: next?.key, resetSequence });
  }

  const active = request?.resetSequence === resetSequence ? request : null;
  const category = active?.category;
  const available = category && active?.key ? pending.filter((entry) =>
    entry.categories.includes(category) && full[category].some(({ id }) => id === entry.incidentId),
  ) : [];
  const choice = available.find(({ key }) => key === active?.key) ?? available[0];
  const id = choice?.incidentId;
  const key = choice?.key;
  const location = category && id ? { category, id } : revealed;
  const outside = location && !queues[location.category].some(({ id }) => id === location.id)
    ? full[location.category].find(({ id }) => id === location.id) : undefined;
  const visible = outside && location
    ? { ...queues, [location.category]: [...queues[location.category], outside].sort(compareIncidents) }
    : queues;
  const pulseVisible = Boolean(pulse && visible[pulse.category].some(({ id }) => id === pulse.id));
  const needsReveal = Boolean(outside && category && id);

  useLayoutEffect(() => {
    if (!active || !category) return;
    const region = document.getElementById(queueId(category));
    if (!region) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduce ? "instant" : "smooth";
    const focusRegion = () => {
      region.focus({ preventScroll: true });
      region.scrollIntoView({ block: "start", behavior });
    };
    const card = id ? region.querySelector<HTMLElement>(`[data-incident-id="${CSS.escape(id)}"]`) : null;
    const title = card?.querySelector<HTMLElement>("[data-card-title]");
    if (!id || !key || !title) {
      focusRegion();
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
        if (needsReveal) setRevealed({ category: category, id: id });
        if (category === "critical") setPulse({ category, id: id });
        onViewed(key);
      } else {
        focusRegion();
      }
      setRequest(null);
    };

    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [active, category, id, key, needsReveal, onViewed]);

  const finishPulse = useCallback(() => setPulse(null), []);
  useLayoutEffect(() => {
    if (pulse && !pulseVisible) finishPulse();
  }, [pulse, pulseVisible, finishPulse]);

  useEffect(() => {
    if (!pulse) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    const handleMotion = () => {
      window.clearTimeout(timer);
      if (motion.matches) timer = window.setTimeout(finishPulse, PULSE_MS);
    };
    handleMotion();
    motion.addEventListener("change", handleMotion);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", handleMotion);
    };
  }, [pulse, finishPulse]);

  return { queues: visible, pulse, finishPulse, revealed: outside ? location : null, jump, cancel };
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
