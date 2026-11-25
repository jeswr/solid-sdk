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
import {
  type Library,
  loadLibrary,
  type MusicReadFailure,
  musicRoot,
  provision,
} from "../lib/data/library";
import { LikedSyncPendingError, retryLikedSync, setLiked } from "../lib/data/liked";
import {
  addDriveAudio,
  type DriveAudio,
  listDriveAudio,
  type OwnedFile,
  OwnedRecordingConflictError,
  type OwnedUploadResult,
  uploadMusicFile,
} from "../lib/data/owned";
import {
  createPlaylist,
  deletePlaylist,
  editPlaylist,
  listPlaylists,
  type MusicPlaylist,
  type PlaylistEdit,
} from "../lib/data/playlists";
import { type PreferencesSnapshot, preferencesStore } from "../lib/data/preferences";
import { type ScrobblePlan, saveScrobbles } from "../lib/data/scrobbles";
import { type MusicDocument, MusicWriteError, type Playback } from "../lib/model";

export interface MusicSnapshot {
  library: Library;
  playlists: MusicPlaylist[];
  history: Playback[];
  preferences: PreferencesSnapshot;
  failures?: MusicReadFailure[];
  libraryError?: unknown;
}
type Patch = (snapshot: MusicSnapshot) => MusicSnapshot;
type ConfirmedWrite = { apply: Patch; document?: Pick<MusicDocument, "url" | "etag"> };
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
  /** The pod storage root Music reads and writes. */
  storage: string;
  /** Saves imported listens, then reloads Music so they appear. */
  importListens(
    plan: ScrobblePlan,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ added: number; existing: number }>;
  importFile(file: OwnedFile): Promise<OwnedUploadResult | false>;
  fromDrive(url: string): Promise<boolean>;
  driveFiles(): Promise<DriveAudio[]>;
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
        return {
          ...playlist,
          ...(edit.name !== undefined ? { name: edit.name.trim() } : {}),
          ...(edit.description !== undefined ? { description: edit.description.trim() } : {}),
        };
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
  const patches = useRef<{ id: number; apply: Patch; positionalFor?: string | undefined }[]>([]);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const mounted = useRef(false);
  const counter = useRef(0);
  const months = useRef(13);
  const olderRequest = useRef<Promise<void> | undefined>(undefined);
  const dirty = useRef(false);
  const reconciliationPending = useRef(false);
  const publish = useCallback(() => {
    if (!mounted.current || !baseline.current) return;
    const snapshot = patches.current.reduce((value, patch) => patch.apply(value), baseline.current);
    setState({
      status: snapshot.libraryError ? "error" : snapshot.library.tracks.length ? "ready" : "empty",
      snapshot,
      error: snapshot.libraryError,
    });
    setSaving(patches.current.length > 0);
  }, []);
  const read = useCallback(
    async function read(): Promise<{ snapshot: MusicSnapshot; months: number }> {
      const range = months.current;
      const failures: MusicReadFailure[] = [];
      const report = (failure: MusicReadFailure) => failures.push(failure);
      let libraryError: unknown;
      const [library, history, preferences] = await Promise.all([
        loadLibrary(session.fetch, session.storageUrl, report).catch((error: unknown): Library => {
          libraryError = error;
          report({ url: musicRoot(session.storageUrl), error, area: "library" });
          return (
            baseline.current?.library ?? {
              tracks: [],
              albums: [],
              artists: [],
              documents: new Map(),
              models: { tracks: [], albums: [], artists: [], playlists: [] },
            }
          );
        }),
        loadHistory(session.fetch, session.storageUrl, new Date(), range, 0, report),
        preferencesStore(session.fetch, session.storageUrl)
          .load()
          .catch((error: unknown) => {
            report({
              url: new URL("preferences.json", musicRoot(session.storageUrl)).href,
              error,
              area: "preferences",
            });
            return (
              baseline.current?.preferences ?? { value: { artwork: "none" as const }, etag: null }
            );
          }),
      ]);
      // A pagination request may have extended the range while this read was in flight.
      // Retry the complete snapshot so neither refresh nor write reconciliation drops it.
      if (range !== months.current) return read();
      return {
        snapshot: {
          library,
          playlists:
            libraryError && baseline.current ? baseline.current.playlists : listPlaylists(library),
          history,
          preferences,
          failures,
          libraryError,
        },
        months: range,
      };
    },
    [session],
  );
  const refresh = useCallback(async () => {
    if (patches.current.length) {
      dirty.current = true;
      return;
    }
    dirty.current = false;
    const request = ++generation.current;
    try {
      await ensureSample(session);
      let loaded = await read();
      try {
        if (
          !loaded.snapshot.failures?.some((failure) => failure.area === "library") &&
          (await retryLikedSync(session.fetch, session.storageUrl, loaded.snapshot.library))
        ) {
          loaded = await read();
          setNotice("Liked songs playlist synchronized.");
        }
      } catch {
        setNotice("Liked songs are saved. Playlist synchronization is pending; refresh to retry.");
      }
      while (loaded.months !== months.current) loaded = await read();
      if (mounted.current && request === generation.current && !patches.current.length) {
        baseline.current = loaded.snapshot;
        reconciliationPending.current = false;
        publish();
      }
    } catch (error) {
      if (mounted.current && request === generation.current && !patches.current.length) {
        // A failed re-read must not erase music that was already visible or saved.
        setState((current) => ({
          ...current,
          status: reconciliationPending.current && baseline.current ? current.status : "error",
          error,
        }));
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

  function confirm({ apply, document }: ConfirmedWrite) {
    // Every writer installs its returned snapshot/ETag before any fallible refresh.
    // Queued writes always start from this confirmed baseline.
    ++generation.current;
    if (!baseline.current) return;
    const next = { ...apply(baseline.current) };
    if (document) {
      const documents = new Map(next.library.documents);
      const previous = documents.get(document.url);
      if (previous) documents.set(document.url, { ...previous, ...document });
      next.library = { ...next.library, documents };
      next.playlists = next.playlists.map((playlist) =>
        playlist.id.split("#")[0] === document.url
          ? { ...playlist, etag: document.etag }
          : playlist,
      );
    }
    baseline.current = next;
  }

  function mutate(
    apply: Patch,
    work: (current: MusicSnapshot) => Promise<ConfirmedWrite> | Promise<void>,
    success: string | (() => string),
    playlistId?: string,
    positional = false,
  ): Promise<boolean> {
    if (!baseline.current) return Promise.resolve(false);
    const id = ++counter.current;
    ++generation.current;
    patches.current.push({ id, apply, positionalFor: positional ? playlistId : undefined });
    publish();
    const task = serial.current.then(async () => {
      // A failed earlier edit invalidates positions captured from its optimistic order.
      if (!patches.current.some((patch) => patch.id === id)) return false;
      let ok = false;
      let message = typeof success === "string" ? success : "";
      try {
        if (!baseline.current) throw new Error("Music is unavailable");
        const committed = await work(baseline.current);
        confirm(committed ?? { apply });
        ok = true;
        message = typeof success === "string" ? success : success();
      } catch (error) {
        if (error instanceof LikedSyncPendingError) {
          confirm({ apply, document: error.document });
          ok = true;
          message = "Liked songs are saved. Playlist synchronization is pending; refresh to retry.";
        } else {
          message =
            error instanceof OwnedRecordingConflictError
              ? error.message
              : error instanceof MusicWriteError && error.status === 412
                ? "This item changed elsewhere. We refreshed it; try your change again."
                : "Couldn’t save your change. Please try again.";
          if (playlistId) {
            patches.current = patches.current.filter((patch) => patch.positionalFor !== playlistId);
            message += " Queued song moves and removals were cancelled; please try them again.";
          }
        }
        if (mounted.current) toast.error(message);
      }
      // Reconciliation cannot turn a committed write into a failed save. Keep its
      // result (including fresh playlist ETags) and retry reads on refresh/focus.
      try {
        let loaded = await read();
        while (loaded.months !== months.current) loaded = await read();
        if (loaded.snapshot.libraryError) throw loaded.snapshot.libraryError;
        baseline.current = loaded.snapshot;
        reconciliationPending.current = false;
      } catch {
        if (ok) {
          reconciliationPending.current = true;
          message += " Saved changes are shown; refresh Music to retry loading from your pod.";
        }
      }
      if (mounted.current) setNotice(message);
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
      const apply: Patch = (snapshot) => ({
        ...snapshot,
        library: {
          ...snapshot.library,
          tracks: snapshot.library.tracks.map((track) =>
            track.id === id ? { ...track, loved } : track,
          ),
        },
      });
      void mutate(
        apply,
        async (snapshot) => {
          const document = await setLiked(
            session.fetch,
            session.storageUrl,
            snapshot.library,
            id,
            loved,
          );
          return { document, apply };
        },
        loved ? "Added to Liked songs" : "Removed from Liked songs",
      );
    },
    async create(name, description) {
      let id: string | undefined;
      const created = await mutate(
        (snapshot) => snapshot,
        async () => {
          await provision(session.fetch, session.storageUrl);
          const playlist = await createPlaylist(
            session.fetch,
            session.storageUrl,
            crypto.randomUUID(),
            name,
            description,
          );
          id = playlist.id;
          return {
            apply: (snapshot) => ({ ...snapshot, playlists: [...snapshot.playlists, playlist] }),
            document: { url: playlist.id.split("#")[0] as string, etag: playlist.etag },
          };
        },
        "Playlist created",
      );
      return created ? id : undefined;
    },
    edit(playlist, edit) {
      // Retain only fields changed from the caller's opening snapshot.
      if (edit.kind === "rename")
        edit = {
          kind: "rename",
          ...(edit.name !== undefined && edit.name.trim() !== playlist.name
            ? { name: edit.name.trim() }
            : {}),
          ...(edit.description !== undefined && edit.description.trim() !== playlist.description
            ? { description: edit.description.trim() }
            : {}),
        };
      if (
        (edit.kind === "move" && edit.from === edit.to) ||
        (edit.kind === "add" && !edit.tracks.length) ||
        (edit.kind === "rename" && edit.name === undefined && edit.description === undefined)
      )
        return;
      void mutate(
        (snapshot) => optimisticPlaylist(snapshot, playlist.id, edit),
        async (snapshot) => {
          const current = snapshot.playlists.find((p) => p.id === playlist.id) ?? playlist;
          if (
            edit.kind === "rename" &&
            ((edit.name !== undefined && current.name !== playlist.name) ||
              (edit.description !== undefined && current.description !== playlist.description))
          )
            throw new MusicWriteError(412, current.etag);
          // Also fence edits enqueued while a failed write is still reconciling:
          // their displayed positions may belong to the discarded optimistic order.
          if (
            (edit.kind === "move" || edit.kind === "remove") &&
            (current.tracks.length !== playlist.tracks.length ||
              current.tracks.some((id, index) => id !== playlist.tracks[index]))
          )
            throw new MusicWriteError(412, current.etag);
          const saved = await editPlaylist(session.fetch, session.storageUrl, current, edit);
          return {
            apply: (current) => ({
              ...current,
              playlists: current.playlists.map((p) => (p.id === saved.id ? saved : p)),
            }),
            document: { url: saved.id.split("#")[0] as string, etag: saved.etag },
          };
        },
        edit.kind === "move" ? `Moved song to position ${edit.to + 1}` : "Playlist saved",
        playlist.id,
        edit.kind === "move" || edit.kind === "remove",
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
        playlist.id,
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
          const preferences = await preferencesStore(session.fetch, session.storageUrl).save(
            snapshot.preferences,
            preference,
          );
          return { apply: (current) => ({ ...current, preferences }) };
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
    async importFile(file) {
      let result: OwnedUploadResult | false = false;
      const ok = await mutate(
        (snapshot) => snapshot,
        async () => {
          result = await uploadMusicFile(session.fetch, session.storageUrl, file);
        },
        () =>
          result && result.status === "already-owned"
            ? "Already in your library"
            : "Music file added",
      );
      return ok ? result : false;
    },
    fromDrive(url) {
      return mutate(
        (snapshot) => snapshot,
        async () => {
          await addDriveAudio(session.fetch, session.storageUrl, url);
        },
        "Added from Drive",
      );
    },
    driveFiles() {
      return listDriveAudio(session.fetch, session.storageUrl);
    },
    storage: session.storageUrl,
    async importListens(plan, onProgress) {
      try {
        await provision(session.fetch, session.storageUrl);
        return await saveScrobbles(session.fetch, session.storageUrl, plan, onProgress);
      } finally {
        // Months saved before a failure are kept, so show them either way.
        await refresh();
      }
    },
    olderLoading,
    olderError,
    older() {
      if (olderRequest.current) return olderRequest.current;
      const task = (async () => {
        setOlderLoading(true);
        setOlderError(false);
        setNotice("Loading older history…");
        try {
          const failures: MusicReadFailure[] = [];
          const history = await loadHistory(
            session.fetch,
            session.storageUrl,
            new Date(),
            12,
            months.current,
            (failure) => failures.push(failure),
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
              failures: [...(baseline.current.failures ?? []), ...failures],
              history: [
                ...new Map(
                  [...baseline.current.history, ...history].map((play) => [play.iri, play]),
                ).values(),
              ].sort((a, b) => b.startTime.getTime() - a.startTime.getTime()),
            };
            publish();
          }
        } catch {
          setOlderError(true);
        } finally {
          setOlderLoading(false);
          olderRequest.current = undefined;
        }
      })();
      olderRequest.current = task;
      return task;
    },
  };
  return <Context value={value}>{children}</Context>;
}
export function useMusic(): MusicContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("MusicProvider is required");
  return value;
}
