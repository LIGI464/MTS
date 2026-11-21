import { useEffect, useRef, useState } from "react";

function playChime(context: AudioContext, start: number): void {
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

export function useIncidentSound(sequence: number) {
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [activating, setActivating] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const lastPlayed = useRef(0);
  const nextStart = useRef(0);
  const currentSequence = useRef(sequence);

  useEffect(() => {
    currentSequence.current = sequence;
    const count = sequence - lastPlayed.current;
    lastPlayed.current = sequence;
    const context = contextRef.current;
    if (!enabled || count <= 0 || context?.state !== "running") return;
    let start = Math.max(context.currentTime + .015, nextStart.current);
    for (let index = 0; index < count; index++) {
      playChime(context, start);
      start += .34;
    }
    nextStart.current = start;
  }, [enabled, sequence]);

  useEffect(() => () => {
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }, []);

  async function toggle() {
    if (enabled) {
      setEnabled(false);
      const context = contextRef.current;
      contextRef.current = null;
      nextStart.current = 0;
      void context?.close().catch(() => {});
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
