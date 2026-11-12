// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all assist/source/organizeImports: Establish the DOM before importing browser glue.
import { deferred } from "./drive-ui-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type AudioStatus,
  createAudioEngine,
  mediaSession,
} from "../src/apps/music/lib/browser/audio";
import { sampleWav } from "../src/apps/music/demo/wav";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://audio.test/";
let clock = 0;
const paused = new WeakMap<HTMLMediaElement, boolean>();
const disposals: (() => void)[] = [];
beforeEach(() => {
  clock = 0;
  const proto = window.HTMLMediaElement.prototype;
  vi.spyOn(proto, "paused", "get").mockImplementation(function (this: HTMLMediaElement) {
    return paused.get(this) ?? true;
  });
  vi.spyOn(proto, "duration", "get").mockReturnValue(120);
  vi.spyOn(proto, "play").mockImplementation(async function (this: HTMLMediaElement) {
    paused.set(this, false);
    this.dispatchEvent(new Event("play"));
  });
  vi.spyOn(proto, "pause").mockImplementation(function (this: HTMLMediaElement) {
    paused.set(this, true);
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(proto, "load").mockImplementation(function (this: HTMLMediaElement) {
    this.currentTime = 0;
  });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-audio");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.restoreAllMocks();
});
async function fixture(
  fetchOverride?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch,
) {
  const pod = createDemoPod({ root });
  await pod.fetch(`${root}music/files/a.wav`, {
    method: "PUT",
    headers: { "Content-Type": "audio/wav" },
    body: sampleWav(),
  });
  let status: AudioStatus | undefined;
  const ended = vi.fn();
  const engine = createAudioEngine(
    fetchOverride?.(pod.fetch) ?? pod.fetch,
    root,
    (next) => {
      status = next;
    },
    ended,
  );
  disposals.push(engine.dispose);
  const audio = document.querySelector("audio") as HTMLAudioElement;
  return { pod, engine, audio, ended, status: () => status as AudioStatus };
}
it("uses one hidden audio element, counts actual hearing, excludes seeks and pauses, resets and revokes URLs", async () => {
  const { engine, audio, status, ended } = await fixture();
  expect(document.querySelectorAll("audio")).toHaveLength(1);
  expect(audio.hidden).toBe(true);
  await engine.load(`${root}music/files/a.wav`);
  expect(status().playing).toBe(true);
  clock = 10_000;
  audio.currentTime = 10;
  audio.dispatchEvent(new Event("timeupdate"));
  expect(status().listened).toBe(10);
  engine.pause();
  clock = 20_000;
  audio.currentTime = 20;
  audio.dispatchEvent(new Event("timeupdate"));
  expect(status().listened).toBe(10);
  engine.seek(80);
  expect(status().elapsed).toBe(80);
  expect(status().listened).toBe(10);
  await engine.play();
  clock = 21_000;
  audio.currentTime = 81;
  audio.dispatchEvent(new Event("timeupdate"));
  expect(status().listened).toBe(11);
  engine.volume(0.4, true);
  expect(audio.volume).toBe(0.4);
  expect(audio.muted).toBe(true);
  audio.dispatchEvent(new Event("ended"));
  expect(ended).toHaveBeenCalledOnce();
  await engine.load(`${root}music/files/a.wav`);
  expect(status().listened).toBe(0);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:owned-audio");
  engine.stop();
  expect(status()).toMatchObject({ listened: 0, playing: false, loading: false });
});
it("stops a pending authenticated load and prevents stale responses from creating playback URLs", async () => {
  const first = deferred<Response>();
  let requests = 0;
  const { engine, pod, status } = await fixture((fetch) => async (input, init) => {
    if (++requests === 1) return first.promise;
    return fetch(input, init);
  });
  const pending = engine.load(`${root}music/files/a.wav`);
  await engine.load(`${root}music/files/a.wav`);
  first.resolve(await pod.fetch(`${root}music/files/a.wav`));
  await pending;
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(status().playing).toBe(true);
  engine.stop();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});
it("shows read and codec failures, and an autoplay refusal can be retried", async () => {
  const { engine, audio, status } = await fixture();
  await engine.load(`${root}music/files/missing.wav`);
  expect(status().error).toContain("Couldn't load");
  const play = vi
    .spyOn(window.HTMLMediaElement.prototype, "play")
    .mockRejectedValueOnce(new Error("Denied"));
  await engine.load(`${root}music/files/a.wav`);
  expect(status().error).toContain("couldn't start");
  await engine.play();
  expect(play).toHaveBeenCalledTimes(2);
  expect(status().error).toBe("");
  audio.dispatchEvent(new Event("error"));
  expect(status().error).toContain("audio format");
});
it("registers MediaSession metadata, artwork and controls and clears handlers on teardown", () => {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: {
      metadata: null,
      setActionHandler: (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        handlers.set(action, handler);
      },
    },
  });
  vi.stubGlobal(
    "MediaMetadata",
    class {
      constructor(value: MediaMetadataInit) {
        Object.assign(this, value);
      }
    },
  );
  const actions = {
    play: vi.fn(),
    pause: vi.fn(),
    nexttrack: vi.fn(),
    previoustrack: vi.fn(),
    seekto: vi.fn(),
  };
  const cleanup = mediaSession(
    { title: "Chime", artist: "Listener", albumTitle: "Your files" },
    actions,
    "blob:cover",
  );
  expect(navigator.mediaSession.metadata).toMatchObject({
    title: "Chime",
    artwork: [{ src: "blob:cover" }],
  });
  handlers.get("nexttrack")?.({ action: "nexttrack" });
  handlers.get("seekto")?.({ action: "seekto", seekTime: 42 });
  expect(actions.nexttrack).toHaveBeenCalledOnce();
  expect(actions.seekto).toHaveBeenCalledWith(42);
  cleanup();
  expect(navigator.mediaSession.metadata).toBeNull();
  expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
  Reflect.deleteProperty(navigator, "mediaSession");
});

// AUTHORED-BY Codex GPT-6
it("publishes play intent while loading and keeps the current download when intent changes", async () => {
  const response = deferred<Response>();
  const { engine, pod, status } = await fixture(() => () => response.promise);
  const loading = engine.load(`${root}music/files/a.wav`);
  expect(status()).toMatchObject({ loading: true, playing: false, wantsPlay: true });
  engine.pause();
  expect(status()).toMatchObject({ loading: true, playing: false, wantsPlay: false });
  await engine.play();
  expect(status()).toMatchObject({ loading: true, playing: false, wantsPlay: true });
  response.resolve(await pod.fetch(`${root}music/files/a.wav`));
  await loading;
  expect(status()).toMatchObject({ loading: false, playing: true, wantsPlay: true });
});
it("restarts using the same object URL while resetting the listened time", async () => {
  const { engine, audio, status } = await fixture();
  await engine.load(`${root}music/files/a.wav`);
  clock = 10_000;
  audio.currentTime = 10;
  audio.dispatchEvent(new Event("timeupdate"));
  expect(status().listened).toBe(10);
  engine.restart();
  expect(status()).toMatchObject({ elapsed: 0, listened: 0 });
  expect(audio.src).toBe("blob:owned-audio");
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  clock = 15_000;
  audio.currentTime = 5;
  audio.dispatchEvent(new Event("timeupdate"));
  expect(status().listened).toBe(5);
});

it("keeps cancelled loads paused and ignores stale failures after stopping", async () => {
  const response = deferred<Response>();
  const { engine, pod, status } = await fixture(() => () => response.promise);
  const loading = engine.load(`${root}music/files/a.wav`);
  engine.pause();
  response.resolve(await pod.fetch(`${root}music/files/a.wav`));
  await loading;
  expect(status()).toMatchObject({ loading: false, playing: false, wantsPlay: false });
  const playing = deferred<void>();
  vi.spyOn(window.HTMLMediaElement.prototype, "play").mockReturnValueOnce(playing.promise);
  const pending = engine.play();
  engine.stop();
  playing.reject(new Error("Stale refusal"));
  await pending;
  expect(status().error).toBe("");
  const rejected = deferred<Response>();
  const next = await fixture(() => () => rejected.promise);
  const stopped = next.engine.load(`${root}music/files/a.wav`);
  next.engine.stop();
  rejected.reject(new Error("Aborted"));
  await stopped;
  expect(next.status().error).toBe("");
});
it("excludes browser seeking events from listening time and tolerates unknown durations", async () => {
  vi.spyOn(window.HTMLMediaElement.prototype, "duration", "get").mockReturnValue(NaN);
  const { engine, audio, status } = await fixture();
  await engine.load(`${root}music/files/a.wav`);
  expect(status().duration).toBe(0);
  clock = 10_000;
  audio.currentTime = 80;
  audio.dispatchEvent(new Event("seeking"));
  audio.dispatchEvent(new Event("seeked"));
  audio.dispatchEvent(new Event("timeupdate"));
  expect(status().listened).toBe(0);
});
it("handles missing and partial MediaSession implementations and publishes play/pause state", async () => {
  const { mediaPlaybackState } = await import("../src/apps/music/lib/browser/audio");
  const track = { title: "Chime", artist: "Listener", albumTitle: "Files" };
  const actions = {
    play: vi.fn(),
    pause: vi.fn(),
    nexttrack: vi.fn(),
    previoustrack: vi.fn(),
    seekto: vi.fn(),
  };
  Reflect.deleteProperty(navigator, "mediaSession");
  mediaSession(track, actions)();
  mediaPlaybackState(true);
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: {
      metadata: null,
      setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
        if (action === "nexttrack") throw new Error("Unsupported action");
        handlers.set(action, handler);
      },
    },
  });
  vi.stubGlobal("MediaMetadata", undefined);
  mediaSession(track, actions)();
  vi.stubGlobal(
    "MediaMetadata",
    class {
      constructor(value: MediaMetadataInit) {
        Object.assign(this, value);
      }
    },
  );
  const cleanup = mediaSession(track, actions);
  expect(navigator.mediaSession.metadata).toMatchObject({ artwork: [] });
  handlers.get("seekto")?.({ action: "seekto" });
  expect(actions.seekto).not.toHaveBeenCalled();
  mediaPlaybackState(true);
  expect(navigator.mediaSession.playbackState).toBe("playing");
  mediaPlaybackState(false);
  expect(navigator.mediaSession.playbackState).toBe("paused");
  cleanup();
  Reflect.deleteProperty(navigator, "mediaSession");
});
