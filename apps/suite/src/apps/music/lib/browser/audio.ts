// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";

export interface AudioStatus {
  elapsed: number;
  duration: number;
  listened: number;
  playing: boolean;
  wantsPlay: boolean;
  loading: boolean;
  error: string;
}
/** One private media element. This cut buffers the complete authenticated blob in memory. */
export function createAudioEngine(
  fetch: typeof globalThis.fetch,
  storage: string,
  update: (status: AudioStatus) => void,
  ended: () => void,
) {
  const audio = document.createElement("audio");
  audio.hidden = true;
  audio.preload = "metadata";
  document.body.append(audio);
  let objectUrl: string | undefined;
  let controller: AbortController | undefined;
  let generation = 0;
  let wanted = false;
  let listened = 0;
  let previous = 0;
  let clock = performance.now();
  let loading = false;
  let error = "";
  const publish = () =>
    update({
      elapsed: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      listened,
      playing: !audio.paused,
      wantsPlay: wanted,
      loading,
      error,
    });
  const sample = () => {
    const now = performance.now();
    if (!audio.paused && !audio.seeking)
      listened += Math.max(0, Math.min(audio.currentTime - previous, (now - clock) / 1000));
    previous = audio.currentTime;
    clock = now;
    publish();
  };
  const play = async () => {
    wanted = true;
    publish();
    if (!objectUrl) return;
    const request = generation;
    try {
      await audio.play();
    } catch {
      if (request !== generation) return;
      error = "Playback couldn't start. Press Play to try again.";
      wanted = false;
      publish();
    }
  };
  const pause = () => {
    wanted = false;
    sample();
    audio.pause();
    publish();
  };
  const listeners: [string, () => void][] = [
    ["timeupdate", sample],
    ["loadedmetadata", publish],
    [
      "play",
      () => {
        previous = audio.currentTime;
        clock = performance.now();
        error = "";
        publish();
      },
    ],
    ["pause", publish],
    [
      "seeking",
      () => {
        previous = audio.currentTime;
        clock = performance.now();
      },
    ],
    [
      "seeked",
      () => {
        previous = audio.currentTime;
        clock = performance.now();
        publish();
      },
    ],
    [
      "ended",
      () => {
        sample();
        ended();
      },
    ],
    [
      "error",
      () => {
        error = "This browser couldn't play this audio format. Try another file.";
        loading = false;
        wanted = false;
        publish();
      },
    ],
  ];
  for (const [type, handler] of listeners) audio.addEventListener(type, handler);
  const release = () => {
    controller?.abort();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  };
  return {
    async load(url: string) {
      const request = ++generation;
      listened = 0;
      previous = 0;
      release();
      controller = new AbortController();
      wanted = true;
      error = "";
      loading = true;
      publish();
      try {
        const response = await createPodScopedFetch(storage, { fetch })(url, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Audio unavailable");
        const blob = await response.blob();
        if (request !== generation) return;
        objectUrl = URL.createObjectURL(blob);
        audio.src = objectUrl;
        loading = false;
        publish();
        if (wanted) await play();
      } catch {
        if (request !== generation) return;
        loading = false;
        wanted = false;
        error = "Couldn't load this file from your pod. Check your connection and retry.";
        publish();
      }
    },
    play,
    pause,
    restart() {
      listened = 0;
      previous = 0;
      audio.currentTime = 0;
      clock = performance.now();
      publish();
      void play();
    },
    seek(seconds: number) {
      audio.currentTime = seconds;
      previous = seconds;
      clock = performance.now();
      publish();
    },
    volume(value: number, muted: boolean) {
      audio.volume = value;
      audio.muted = muted;
    },
    stop() {
      ++generation;
      wanted = false;
      listened = 0;
      release();
      loading = false;
      error = "";
      publish();
    },
    dispose() {
      ++generation;
      for (const [type, handler] of listeners) audio.removeEventListener(type, handler);
      release();
      audio.remove();
    },
  };
}

export function mediaSession(
  track: { title: string; artist: string; albumTitle: string },
  actions: {
    play(): void;
    pause(): void;
    nexttrack(): void;
    previoustrack(): void;
    seekto(seconds: number): void;
  },
  artwork?: string,
) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return () => {};
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.albumTitle,
    artwork: artwork ? [{ src: artwork }] : [],
  });
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", actions.play],
    ["pause", actions.pause],
    ["nexttrack", actions.nexttrack],
    ["previoustrack", actions.previoustrack],
    [
      "seekto",
      (details) => {
        if (details.seekTime !== undefined) actions.seekto(details.seekTime);
      },
    ],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      /* Older browsers implement a subset. */
    }
  }
  return () => {
    for (const [action] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        /* Unsupported action. */
      }
    }
    navigator.mediaSession.metadata = null;
  };
}

export function mediaPlaybackState(playing: boolean) {
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}
