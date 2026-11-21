import { useEffect, useRef, useState } from "react";
import type { IncidentAlert } from "./activity";

function playChime(context: AudioContext): void {
  const start = context.currentTime + .015;

  for (const [index, frequency] of [587.33, 783.99].entries()) {
    const time = start + index * .13;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.001, time);
    gain.gain.exponentialRampToValueAtTime(.13, time + .025);
    gain.gain.exponentialRampToValueAtTime(.001, time + .16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(time);
    oscillator.stop(time + .17);
  }
}

export function useIncidentSound(alert: IncidentAlert | null) {
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [activating, setActivating] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const lastPlayed = useRef(0);
  const sequence = alert?.sequence ?? 0;
  const currentSequence = useRef(sequence);

  useEffect(() => {
    currentSequence.current = sequence;
    if (!enabled || sequence <= lastPlayed.current) return;
    lastPlayed.current = sequence;
    const context = contextRef.current;
    if (context?.state === "running") playChime(context);
  }, [enabled, sequence]);

  useEffect(() => () => {
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  async function toggle() {
    if (enabled) {
      setEnabled(false);
      void contextRef.current?.suspend().catch(() => {});
      return;
    }
    if (activating) return;
    setActivating(true);
    try {
      const context = contextRef.current ?? new AudioContext();
      contextRef.current = context;
      await context.resume();
      lastPlayed.current = Math.max(lastPlayed.current, currentSequence.current);
      setUnavailable(false);
      setEnabled(true);
    } catch {
      setUnavailable(true);
    } finally {
      setActivating(false);
    }
  }

  return { enabled, unavailable, activating, toggle };
}
