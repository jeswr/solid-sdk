// AUTHORED-BY Codex GPT-6
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../demo/sample";
import { importSpotifyFixture } from "../demo/spotify";
import { loadHistory } from "../lib/data/history";
import { type Library, loadLibrary, musicRoot } from "../lib/data/library";
import { setLiked } from "../lib/data/liked";
import {
  createPlaylist,
  deletePlaylist,
  editPlaylist,
  listPlaylists,
  type MusicPlaylist,
  type PlaylistEdit,
} from "../lib/data/playlists";
import { type PreferencesSnapshot, preferencesStore } from "../lib/data/preferences";
import { MusicWriteError, type Playback } from "../lib/model";

export interface MusicSnapshot {
  library: Library;
  playlists: MusicPlaylist[];
  history: Playback[];
  preferences: PreferencesSnapshot;
}
type Patch = (snapshot: MusicSnapshot) => MusicSnapshot;
type State = {
  status: "loading" | "ready" | "empty" | "error";
  snapshot?: MusicSnapshot;
  error?: unknown;
};
interface MusicContextValue extends State {
  saving: boolean;
  notice: string;
  refresh(): Promise<void>;
  like(id: string, loved: boolean): void;
  create(name: string, description: string): Promise<string | undefined>;
  edit(playlist: MusicPlaylist, edit: PlaylistEdit): void;
  remove(playlist: MusicPlaylist): Promise<boolean>;
  artwork(enabled: boolean): void;
  importFixture(): Promise<boolean>;
  older(): Promise<void>;
  olderLoading: boolean;
  olderError: boolean;
}
const Context = createContext<MusicContextValue | undefined>(undefined);
export function optimisticPlaylist(
  snapshot: MusicSnapshot,
  id: string,
  edit: PlaylistEdit,
): MusicSnapshot {
  return {
    ...snapshot,
    playlists: snapshot.playlists.map((playlist) => {
      if (playlist.id !== id) return playlist;
      if (edit.kind === "rename")
        return { ...playlist, name: edit.name.trim(), description: edit.description.trim() };
      const tracks = [...playlist.tracks];
      if (edit.kind === "add") tracks.push(...edit.tracks);
      else if (edit.kind === "remove") tracks.splice(edit.position, 1);
      else {
        const [track] = tracks.splice(edit.from, 1);
        if (track) tracks.splice(edit.to, 0, track);
      }
      return { ...playlist, tracks };
    }),
  };
}

export function MusicProvider({ session, children }: { session: PodSession; children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const baseline = useRef<MusicSnapshot | undefined>(undefined);
  const patches = useRef<{ id: number; apply: Patch }[]>([]);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const mounted = useRef(false);
  const counter = useRef(0);
  const months = useRef(13);
  const dirty = useRef(false);
  const publish = useCallback(() => {
    if (!mounted.current || !baseline.current) return;
    const snapshot = patches.current.reduce((value, patch) => patch.apply(value), baseline.current);
    setState({ status: snapshot.library.tracks.length ? "ready" : "empty", snapshot });
    setSaving(patches.current.length > 0);
  }, []);
  const read = useCallback(async (): Promise<MusicSnapshot> => {
    const [library, history, preferences] = await Promise.all([
      loadLibrary(session.fetch, session.storageUrl),
      loadHistory(session.fetch, session.storageUrl, new Date(), months.current),
      preferencesStore(session.fetch, session.storageUrl).load(),
    ]);
    return { library, playlists: listPlaylists(library), history, preferences };
  }, [session]);
  const refresh = useCallback(async () => {
    if (patches.current.length) {
      dirty.current = true;
      return;
    }
    dirty.current = false;
    const request = ++generation.current;
    try {
      await ensureSample(session);
      const snapshot = await read();
      if (mounted.current && request === generation.current && !patches.current.length) {
        baseline.current = snapshot;
        publish();
      }
    } catch (error) {
      if (mounted.current && request === generation.current && !patches.current.length) {
        baseline.current = undefined;
        setState({ status: "error", error });
      }
    }
  }, [read, publish, session]);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    void ensureSample(session).then(
      () => {
        if (live) void refresh();
      },
      (error: unknown) => {
        if (live) setState({ status: "error", error });
      },
    );
    const unsubscribe = session.subscribe((url) => {
      if (
        url.startsWith(musicRoot(session.storageUrl)) ||
        url.startsWith(new URL("integrations/spotify/", session.storageUrl).href)
      ) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void refresh();
        }, 100);
      }
    });
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      live = false;
      ++generation.current;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("focus", focus);
    };
  }, [session, refresh]);

  function mutate(
    apply: Patch,
    work: (current: MusicSnapshot) => Promise<void>,
    success: string,
  ): Promise<boolean> {
    if (!baseline.current) return Promise.resolve(false);
    const id = ++counter.current;
    ++generation.current;
    patches.current.push({ id, apply });
    publish();
    const task = serial.current.then(async () => {
      let ok = false;
      try {
        if (!baseline.current) throw new Error("Music is unavailable");
        await work(baseline.current);
        baseline.current = await read();
        ok = true;
        if (mounted.current) setNotice(success);
      } catch (error) {
        if (mounted.current) {
          const message =
            error instanceof MusicWriteError && error.status === 412
              ? "This item changed elsewhere. We refreshed it; try your change again."
              : "Couldn’t save your change. Please try again.";
          toast.error(message);
          setNotice(message);
        }
        try {
          baseline.current = await read();
        } catch {
          /* Keep the confirmed snapshot if storage is offline. */
        }
      }
      patches.current = patches.current.filter((patch) => patch.id !== id);
      publish();
      if (dirty.current && patches.current.length === 0) void refresh();
      return ok;
    });
    serial.current = task.catch(() => undefined);
    return task;
  }
  const value: MusicContextValue = {
    ...state,
    saving,
    notice,
    refresh,
    like(id, loved) {
      void mutate(
        (snapshot) => ({
          ...snapshot,
          library: {
            ...snapshot.library,
            tracks: snapshot.library.tracks.map((track) =>
              track.id === id ? { ...track, loved } : track,
            ),
          },
        }),
        (snapshot) => setLiked(session.fetch, session.storageUrl, snapshot.library, id, loved),
        loved ? "Added to Liked songs" : "Removed from Liked songs",
      );
    },
    async create(name, description) {
      let id: string | undefined;
      const created = await mutate(
        (snapshot) => snapshot,
        async () => {
          const playlist = await createPlaylist(
            session.fetch,
            session.storageUrl,
            crypto.randomUUID(),
            name,
            description,
          );
          id = playlist.id;
        },
        "Playlist created",
      );
      return created ? id : undefined;
    },
    edit(playlist, edit) {
      if (
        (edit.kind === "move" && edit.from === edit.to) ||
        (edit.kind === "add" && !edit.tracks.length) ||
        (edit.kind === "rename" &&
          edit.name.trim() === playlist.name &&
          edit.description.trim() === playlist.description)
      )
        return;
      void mutate(
        (snapshot) => optimisticPlaylist(snapshot, playlist.id, edit),
        (snapshot) =>
          editPlaylist(
            session.fetch,
            session.storageUrl,
            snapshot.playlists.find((p) => p.id === playlist.id) ?? playlist,
            edit,
          ),
        edit.kind === "move" ? `Moved song to position ${edit.to + 1}` : "Playlist saved",
      );
    },
    remove(playlist) {
      return mutate(
        (snapshot) => ({
          ...snapshot,
          playlists: snapshot.playlists.filter((p) => p.id !== playlist.id),
        }),
        (snapshot) =>
          deletePlaylist(
            session.fetch,
            session.storageUrl,
            snapshot.playlists.find((p) => p.id === playlist.id) ?? playlist,
          ),
        "Playlist deleted",
      );
    },
    artwork(enabled) {
      const preference = { artwork: enabled ? ("hot-link" as const) : ("none" as const) };
      void mutate(
        (snapshot) => ({
          ...snapshot,
          preferences: { ...snapshot.preferences, value: preference },
        }),
        async (snapshot) => {
          await preferencesStore(session.fetch, session.storageUrl).save(
            snapshot.preferences,
            preference,
          );
        },
        "Artwork preference saved",
      );
    },
    importFixture() {
      return mutate(
        (snapshot) => snapshot,
        () => importSpotifyFixture(session.fetch, session.storageUrl),
        "Spotify sample imported",
      );
    },
    olderLoading,
    olderError,
    async older() {
      setOlderLoading(true);
      setOlderError(false);
      setNotice("Loading older history…");
      try {
        const history = await loadHistory(
          session.fetch,
          session.storageUrl,
          new Date(),
          12,
          months.current,
        );
        months.current += 12;
        setNotice(
          history.length
            ? `Loaded ${history.length} older plays`
            : "No older plays found in this period",
        );
        if (baseline.current) {
          baseline.current = {
            ...baseline.current,
            history: [...baseline.current.history, ...history].sort(
              (a, b) => b.startTime.getTime() - a.startTime.getTime(),
            ),
          };
          publish();
        }
      } catch {
        setOlderError(true);
      } finally {
        setOlderLoading(false);
      }
    },
  };
  return <Context value={value}>{children}</Context>;
}
export function useMusic(): MusicContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("MusicProvider is required");
  return value;
}
