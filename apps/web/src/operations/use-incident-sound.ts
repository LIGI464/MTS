import { useEffect, useRef, useState } from "react";
import notificationUrl from "./pda_4LbLWWH.mp3";

type IncidentSound = {
  context: AudioContext;
  loading: AbortController;
  clip: AudioBuffer | null;
  nextStart: number;
};

async function loadClip({ context, loading }: IncidentSound): Promise<AudioBuffer> {
  const response = await fetch(notificationUrl, { signal: loading.signal });
  if (!response.ok) throw new Error("Не удалось загрузить звук оповещений.");
  return context.decodeAudioData(await response.arrayBuffer());
}

function disposeSound(sound: IncidentSound | null): void {
  if (!sound) return;
  sound.loading.abort();
  if (sound.context.state !== "closed") void sound.context.close().catch(() => {});
}

function playClip(context: AudioContext, clip: AudioBuffer, start: number): void {
  const source = context.createBufferSource();
  source.buffer = clip;
  source.connect(context.destination);
  source.onended = () => source.disconnect();
  source.start(start);
}

export function useIncidentSound(sequence: number) {
  const [enabled, setEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [activating, setActivating] = useState(false);
  const soundRef = useRef<IncidentSound | null>(null);
  const lastSequence = useRef(0);
  const currentSequence = useRef(sequence);

  useEffect(() => {
    currentSequence.current = sequence;
    const count = sequence - lastSequence.current;
    lastSequence.current = sequence;
    const sound = soundRef.current;
    if (!enabled || count <= 0 || !sound?.clip || sound.context.state !== "running") return;
    let start = Math.max(sound.context.currentTime + .015, sound.nextStart);
    for (let index = 0; index < count; index++) {
      playClip(sound.context, sound.clip, start);
      start += sound.clip.duration + .05;
    }
    sound.nextStart = start;
  }, [enabled, sequence]);

  useEffect(() => () => {
    const sound = soundRef.current;
    soundRef.current = null;
    disposeSound(sound);
  }, []);

  async function toggle() {
    if (enabled) {
      setEnabled(false);
      const sound = soundRef.current;
      soundRef.current = null;
      disposeSound(sound);
      return;
    }
    if (soundRef.current) return;
    let context: AudioContext;
    try {
      context = new AudioContext();
    } catch {
      setUnavailable(true);
      return;
    }

    const sound: IncidentSound = { context, loading: new AbortController(), clip: null, nextStart: 0 };
    soundRef.current = sound;
    setActivating(true);
    let clip: AudioBuffer | null;
    try {
      [, clip] = await Promise.all([context.resume(), loadClip(sound)]);
    } catch {
      clip = null;
    }
    if (soundRef.current !== sound) return;
    setActivating(false);
    if (!clip || context.state !== "running") {
      soundRef.current = null;
      disposeSound(sound);
      setUnavailable(true);
      return;
    }
    sound.clip = clip;
    lastSequence.current = Math.max(lastSequence.current, currentSequence.current);
    setUnavailable(false);
    setEnabled(true);
  }

  return { enabled, unavailable, activating, toggle };
}
