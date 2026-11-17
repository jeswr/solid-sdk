// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { createPodScopedFetch, podScopedUrl } from "@jeswr/guarded-fetch";
import { toast } from "@jeswr/suite-ui";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import {
  type AudioStatus,
  createAudioEngine,
  mediaPlaybackState,
  mediaSession,
} from "../lib/browser/audio";
import { acquireCoverUrl } from "../lib/browser/object-url";
import type { MusicTrack } from "../lib/data/library";
import { musicRoot } from "../lib/data/library";
import { recordOwnedPlay, shouldRecordPlay } from "../lib/data/playback";
import { type Lyrics, parseLrc } from "../lib/lyrics";
import { artworkUrl, historyShard } from "../lib/model";
import { createPlayQueue, type QueueAction, reducePlayQueue } from "../lib/queue";
import { useMusic } from "./music-context";

type Entry = { id: string; track: MusicTrack };
const initial: AudioStatus = {
  elapsed: 0,
  duration: 0,
  listened: 0,
  playing: false,
  wantsPlay: false,
  loading: false,
  error: "",
};
function usePlayerState(session: PodSession) {
  const music = useMusic();
  const [queue, setQueue] = useState(() => createPlayQueue<Entry>([]));
  const [audio, setAudio] = useState(initial);
  const [nonce, setNonce] = useState(0);
  const loadedUrl = useRef<string | undefined>(undefined);
  const forceReload = useRef(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const audioSettings = useRef({ volume, muted });
  audioSettings.current = { volume, muted };
  const [lyrics, setLyrics] = useState<Lyrics>();
  const [lyricsError, setLyricsError] = useState("");
  const [mediaArtwork, setMediaArtwork] = useState<string>();
  const engine = useRef<ReturnType<typeof createAudioEngine> | null>(null);
  const dispatchRef = useRef<(action: QueueAction<Entry>) => void>(() => {});
  const current = queue.entries.find((entry) => entry.id === queue.currentId)?.track;
  const occurrence = useRef<{
    iri: string;
    startTime: Date;
    track: MusicTrack;
    saved: boolean;
  } | null>(null);
  const latest = useRef(music);
  latest.current = music;
  useEffect(() => {
    const instance = createAudioEngine(
      session.fetch,
      session.storageUrl,
      (status) => {
        setAudio(status);
        const play = occurrence.current;
        if (
          play &&
          !play.saved &&
          shouldRecordPlay(status.listened, status.duration || play.track.durationSeconds)
        ) {
          play.saved = true;
          void recordOwnedPlay(session.fetch, session.storageUrl, {
            iri: play.iri,
            trackIri: play.track.id,
            startTime: play.startTime,
          }).then(
            () => latest.current.refresh(),
            () => toast.error("Couldn't save this listen. Your music keeps playing."),
          );
        }
      },
      () => dispatchRef.current({ type: "ended" }),
    );
    engine.current = instance;
    instance.volume(audioSettings.current.volume, audioSettings.current.muted);
    return () => {
      engine.current = null;
      occurrence.current = null;
      loadedUrl.current = undefined;
      instance.dispose();
    };
  }, [session]);
  const url = current?.contentUrl;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation and natural repeat restart even the same immutable track payload.
  useEffect(() => {
    if (!url || !current) {
      occurrence.current = null;
      loadedUrl.current = undefined;
      engine.current?.stop();
      return;
    }
    const startTime = new Date();
    occurrence.current = {
      iri: `${historyShard(musicRoot(session.storageUrl), startTime)}#owned-${crypto.randomUUID()}`,
      startTime,
      track: current,
      saved: false,
    };
    if (loadedUrl.current === url && !forceReload.current && !audio.error)
      engine.current?.restart();
    else void engine.current?.load(url);
    loadedUrl.current = url;
    forceReload.current = false;
    // A new queue occurrence/repeat starts a fresh listen, even for the same song.
  }, [url, current, queue.currentId, nonce, session]);
  useEffect(() => {
    engine.current?.volume(volume, muted);
  }, [volume, muted]);
  useEffect(() => {
    setLyrics(undefined);
    setLyricsError("");
    if (!current?.lyricsUrl) return;
    const controller = new AbortController();
    void createPodScopedFetch(session.storageUrl, { fetch: session.fetch })(current.lyricsUrl, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Lyrics unavailable");
        const text = await response.text();
        if (!controller.signal.aborted) setLyrics(parseLrc(text));
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLyricsError("Couldn't load lyrics. Try playing this song again.");
      });
    return () => controller.abort();
  }, [current?.lyricsUrl, session]);
  function dispatch(action: QueueAction<Entry>) {
    if (["skip", "previous", "ended"].includes(action.type)) setNonce((n) => n + 1);
    setQueue((q) => reducePlayQueue(q, action));
  }
  dispatchRef.current = dispatch;
  const next = () => dispatch({ type: "skip" });
  const previous = () => dispatch({ type: "previous", elapsedSeconds: audio.elapsed });
  const pause = () => engine.current?.pause();
  const play = () => {
    if (!current && queue.entries.length) {
      next();
      return;
    }
    if (audio.error) {
      forceReload.current = true;
      setNonce((n) => n + 1);
      return;
    }
    void engine.current?.play();
  };
  const active = audio.playing || (audio.loading && audio.wantsPlay);
  const toggle = () => {
    if (active) pause();
    else play();
  };
  useEffect(() => {
    mediaPlaybackState(active);
  }, [active]);
  const controls = useRef({ toggle, next, previous, play, pause });
  controls.current = { toggle, next, previous, play, pause };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat)
        return;
      if (!(event.target instanceof Element)) return;
      const target = event.target;
      if (
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role=slider], [role=menu], [role=combobox], [role=textbox], [role=spinbutton]',
        )
      )
        return;
      const dialog = target.closest('[role="dialog"]');
      if (dialog && !dialog.hasAttribute("data-music-player")) return;
      if (
        event.code === "Space" &&
        !target.closest(
          "button, a, summary, [role=button], [role=checkbox], [role=switch], [role=tab], [role=option], [role=menuitem], [role=slider], [role=radio]",
        )
      ) {
        event.preventDefault();
        controls.current.toggle();
      }
      if (event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        controls.current.next();
      }
      if (event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        controls.current.previous();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const artwork = current?.imageUrl;
  const artworkPolicy = music.snapshot?.preferences.value.artwork;
  useEffect(() => {
    setMediaArtwork(undefined);
    if (!artwork) return;
    const local = podScopedUrl(session.storageUrl, artwork, { allowRoot: false });
    if (!local) {
      setMediaArtwork(artworkPolicy ? artworkUrl(artwork, { artwork: artworkPolicy }) : undefined);
      return;
    }
    const cover = acquireCoverUrl(session.fetch, session.storageUrl, local);
    let live = true;
    void cover.promise
      .then((url) => {
        if (live) setMediaArtwork(url);
      })
      .catch(() => {});
    return () => {
      live = false;
      cover.release();
    };
  }, [artwork, artworkPolicy, session]);
  useEffect(() => {
    if (!current) return;
    return mediaSession(
      current,
      {
        play: () => controls.current.play(),
        pause: () => controls.current.pause(),
        nexttrack: () => controls.current.next(),
        previoustrack: () => controls.current.previous(),
        seekto: (seconds) => engine.current?.seek(seconds),
      },
      mediaArtwork,
    );
  }, [current, mediaArtwork]);
  return {
    queue,
    current,
    audio,
    active,
    volume,
    muted,
    lyrics,
    lyricsError,
    setVolume,
    setMuted,
    dispatch,
    next,
    previous,
    toggle,
    seek: (seconds: number) => engine.current?.seek(seconds),
    playTracks(tracks: readonly MusicTrack[], shuffle = false) {
      let nextQueue = createPlayQueue(
        tracks
          .filter((track) => track.contentUrl)
          .map((track) => ({ id: crypto.randomUUID(), track })),
      );
      if (shuffle && nextQueue.entries.length) {
        const all = [...nextQueue.entries];
        const first = Math.floor(Math.random() * all.length);
        [all[0], all[first]] = [all[first] as Entry, all[0] as Entry];
        nextQueue = reducePlayQueue(createPlayQueue(all), {
          type: "shuffle",
          enabled: true,
          seed: Math.floor(Math.random() * 0x100000000),
        });
      }
      setQueue(nextQueue);
      setNonce((n) => n + 1);
    },
    enqueue(track: MusicTrack, next: boolean) {
      dispatch({
        type: next ? "play-next" : "add-to-end",
        entries: [{ id: crypto.randomUUID(), track }],
      });
      toast.success(next ? "Playing next" : "Added to queue");
    },
    clear() {
      setQueue(createPlayQueue<Entry>([]));
    },
  };
}
type Player = ReturnType<typeof usePlayerState>;
const Context = createContext<Player | undefined>(undefined);
export function PlayerProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const player = usePlayerState(session);
  return <Context value={player}>{children}</Context>;
}
export function usePlayer(): Player {
  const player = useContext(Context);
  if (!player) throw new Error("PlayerProvider is required");
  return player;
}
