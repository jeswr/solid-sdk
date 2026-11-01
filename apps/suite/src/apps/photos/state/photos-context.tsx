// AUTHORED-BY Codex GPT-6
"use client";
import { toast, type UploadItem } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../demo/sample";
import { browserEncoder, LocationStripError } from "../lib/browser/encoder";
import {
  changeMembers,
  createAlbum,
  createAlbumWriter,
  listAlbums,
  type StoredAlbum,
} from "../lib/data/albums";
import { preferenceStore, setFavourites } from "../lib/data/favourites";
import { createKeywordWriter, type LibraryPhoto, listLibrary } from "../lib/data/library";
import { type Failure, statusOf } from "../lib/data/shared";
import { photoDataStorage } from "../lib/data/storage";
import type { TakeoutItem, TakeoutPlan } from "../lib/data/takeout";
import {
  emptyTrash,
  listTrash,
  purgePhoto,
  restorePhoto,
  resumeTrash,
  type TrashedPhoto,
  trashPhoto,
} from "../lib/data/trash";
import { uploadFiles } from "../lib/data/upload";
import type { CaptureMetadata } from "../lib/model";

interface Snapshot {
  photos: LibraryPhoto[];
  albums: StoredAlbum[];
  trash: TrashedPhoto[];
  favourites: string[];
  warnings: number;
  albumFailures: Failure[];
}
type Patch = (state: Snapshot) => Snapshot;
const empty: Snapshot = {
  photos: [],
  albums: [],
  trash: [],
  favourites: [],
  warnings: 0,
  albumFailures: [],
};
const Context = createContext<ReturnType<typeof usePhotosState> | null>(null);

function usePhotosState(session: PodSession) {
  const io = useMemo(() => photoDataStorage(session.fetch, session.storageUrl), [session]);
  const preferences = useMemo(() => preferenceStore(session.fetch, session.storageUrl), [session]);
  const writeKeywords = useMemo(() => createKeywordWriter(io), [io]);
  const writeAlbum = useMemo(() => createAlbumWriter(io), [io]);
  const trashOperations = useRef(new Map<string, string>());
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [announcement, announce] = useState("");
  const baseline = useRef(empty);
  const pending = useRef<{ id: number; patch: Patch }[]>([]);
  const sequence = useRef(0);
  const generation = useRef(0);
  const alive = useRef(true);
  const queue = useRef(Promise.resolve());
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const uploadInputs = useRef(
    new Map<
      string,
      { file: Blob; name: string; stripLocation: boolean; metadata?: CaptureMetadata | undefined }
    >(),
  );
  const cancelled = useRef(new Set<string>());
  const redraw = useCallback(() => {
    if (alive.current)
      setSnapshot(pending.current.reduce((value, item) => item.patch(value), baseline.current));
  }, []);
  const refresh = useCallback(async () => {
    if (pending.current.length) return;
    const request = ++generation.current;
    try {
      const [library, albums, trash, prefs] = await Promise.all([
        listLibrary(io),
        listAlbums(io),
        listTrash(io),
        preferences.read(),
      ]);
      if (!alive.current || request !== generation.current || pending.current.length) return;
      baseline.current = {
        photos: library.items,
        albums: albums.items,
        trash: trash.items,
        favourites: prefs.favourites,
        warnings: library.failures.length + albums.failures.length + trash.failures.length,
        albumFailures: albums.failures,
      };
      redraw();
      setStatus(library.items.length ? "ready" : "empty");
    } catch {
      if (alive.current && request === generation.current) {
        baseline.current = empty;
        redraw();
        setStatus("error");
      }
    }
  }, [io, preferences, redraw]);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let live = true;
    void ensureSample(session).then(
      () => {
        if (live) return refresh();
      },
      () => live && setStatus("error"),
    );
    const unsubscribe = session.subscribe((url) => {
      if (!url.startsWith(io.root) && !url.startsWith(io.googlePhotos.root)) return;
      ++generation.current;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (live) void refresh();
      }, 120);
    });
    return () => {
      live = false;
      alive.current = false;
      ++generation.current;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [session, io, refresh]);
  const run = useCallback(
    (patch: Patch, work: () => Promise<Patch>): Promise<boolean> => {
      const id = ++sequence.current;
      ++generation.current;
      pending.current.push({ id, patch });
      redraw();
      setSaving(true);
      let succeeded = false;
      const next = queue.current.then(async () => {
        try {
          const confirmed = await work();
          baseline.current = confirmed(baseline.current);
          succeeded = true;
        } catch (error) {
          toast.error(
            statusOf(error) === 412
              ? "This item changed elsewhere. Your photos have been refreshed."
              : "Couldn't save this change. Please try again.",
          );
        } finally {
          pending.current = pending.current.filter((item) => item.id !== id);
          redraw();
          if (alive.current && !pending.current.length) {
            setSaving(false);
            await refresh();
          }
        }
      });
      queue.current = next;
      return next.then(() => succeeded);
    },
    [redraw, refresh],
  );
  const editAlbum = useCallback(
    (url: string, transform: (album: StoredAlbum) => StoredAlbum, message = "Album saved") => {
      const patch: Patch = (state) => ({
        ...state,
        albums: state.albums.map((album) => (album.url === url ? transform(album) : album)),
      });
      return run(patch, async () => {
        const saved = await writeAlbum.edit(url, transform);
        announce(message);
        return (state) => ({
          ...state,
          albums: state.albums.map((album) => (album.url === url ? saved : album)),
        });
      });
    },
    [writeAlbum, run],
  );
  const newAlbum = useCallback(
    (name: string, refs: string[] = []) => {
      const temporary: StoredAlbum = {
        name,
        url: `${io.root}albums/pending-${crypto.randomUUID()}.ttl`,
        etag: null,
        members: refs,
      };
      return run(
        (s) => ({ ...s, albums: [...s.albums, temporary] }),
        async () => {
          const created = await createAlbum(io, name, new Date().toISOString(), refs);
          const patch: Patch = (s) => ({
            ...s,
            albums: [...s.albums, { ...created, members: refs }],
          });
          return patch;
        },
      );
    },
    [io, run],
  );
  const removeAlbum = useCallback(
    (album: StoredAlbum) => {
      const patch: Patch = (s) => ({
        ...s,
        albums: s.albums.filter((value) => value.url !== album.url),
      });
      return run(patch, async () => {
        await writeAlbum.remove(album);
        return patch;
      });
    },
    [writeAlbum, run],
  );
  const favourite = useCallback(
    (refs: string[], enabled: boolean) => {
      const patch: Patch = (s) => ({
        ...s,
        favourites: enabled
          ? [...new Set([...s.favourites, ...refs])]
          : s.favourites.filter((ref) => !refs.includes(ref)),
      });
      return run(patch, async () => {
        await io.ensureContainers([""]);
        await setFavourites(preferences, refs, enabled);
        return patch;
      });
    },
    [io, preferences, run],
  );
  const restore = useCallback(
    (urls: string[]) => {
      const patch: Patch = (s) => ({
        ...s,
        trash: s.trash.filter((item) => !urls.includes(item.url)),
      });
      return run(patch, async () => {
        for (const url of urls) {
          const outcome = await restorePhoto(io, url);
          if (!outcome.ok) throw outcome.error;
        }
        announce(`${urls.length} photo${urls.length === 1 ? "" : "s"} restored`);
        return patch;
      });
    },
    [io, run],
  );
  const moveToTrash = useCallback(
    (photos: LibraryPhoto[]) => {
      let complete = true;
      const refs = new Set(photos.map((photo) => photo.ref));
      const patch: Patch = (s) => ({
        ...s,
        photos: s.photos.filter((photo) => !refs.has(photo.ref)),
      });
      return run(patch, async () => {
        const urls: string[] = [];
        const moved = new Set<string>();
        const failures: unknown[] = [];
        for (const photo of photos) {
          if (photo.readOnly) {
            failures.push(new Error("Imported photos are read-only"));
            continue;
          }
          let operation = trashOperations.current.get(photo.url);
          if (!operation) {
            // Recover an incomplete move after a reload as well as within this session.
            const recovery = baseline.current.trash.find(
              (item) =>
                item.record.originalUrl === photo.url &&
                item.record.actor === session.webId &&
                !item.record.state &&
                item.url.endsWith(".ttl"),
            );
            operation = recovery
              ? recovery.url.slice(`${io.root}.trash/`.length, -4)
              : crypto.randomUUID();
            trashOperations.current.set(photo.url, operation);
          }
          const outcome = await trashPhoto(
            io,
            photo.url,
            operation,
            session.webId,
            new Date().toISOString(),
          );
          if (!outcome.ok) {
            failures.push(outcome.error);
            continue;
          }
          trashOperations.current.delete(photo.url);
          urls.push(outcome.value);
          moved.add(photo.ref);
        }
        complete = failures.length === 0;
        if (failures.length)
          toast.error(
            `${failures.length} photo${failures.length === 1 ? "" : "s"} couldn't be moved to trash. ${
              failures.some((error) => statusOf(error) === 412)
                ? "An item changed elsewhere. Your photos have been refreshed."
                : "Please try again."
            }`,
          );
        if (urls.length)
          toast(
            complete
              ? "Moved to trash"
              : `Moved ${urls.length} of ${photos.length} photos to trash`,
            {
              duration: 10000,
              action: {
                label: "Undo",
                onClick: () => restore(urls),
              },
            },
          );
        return (s) => ({ ...s, photos: s.photos.filter((photo) => !moved.has(photo.ref)) });
      }).then((ok) => ok && complete);
    },
    [io, run, session.webId, restore],
  );
  const purge = useCallback(
    (urls?: string[]) => {
      const patch: Patch = (s) => ({
        ...s,
        trash: s.trash.filter(
          (item) => item.status === "needs-recovery" || (urls && !urls.includes(item.url)),
        ),
      });
      return run(patch, async () => {
        if (!urls) {
          const result = await emptyTrash(io);
          if (result.failures.length) throw result.failures[0]?.error;
        } else
          for (const url of urls) {
            const result = await purgePhoto(io, url);
            if (!result.ok) throw result.error;
          }
        announce("Photos permanently deleted");
        return patch;
      });
    },
    [io, run],
  );
  const resume = useCallback(
    (urls: string[]) =>
      run(
        (s) => s,
        async () => {
          for (const url of urls) {
            const outcome = await resumeTrash(io, url);
            if (!outcome.ok) throw outcome.error;
          }
          announce("Move to trash completed");
          toast("Moved to trash", {
            duration: 10000,
            action: { label: "Undo", onClick: () => restore(urls) },
          });
          return (s) => s;
        },
      ),
    [io, run, restore],
  );
  const keywords = useCallback(
    (photo: LibraryPhoto, value: string[]) => {
      const patch: Patch = (s) => ({
        ...s,
        photos: s.photos.map((item) =>
          item.ref === photo.ref ? { ...item, keywords: value } : item,
        ),
      });
      return run(patch, async () => {
        const saved = await writeKeywords(photo, value);
        return (s) => ({
          ...s,
          photos: s.photos.map((item) => (item.ref === saved.ref ? saved : item)),
        });
      });
    },
    [writeKeywords, run],
  );
  /** Resolves with the saved photo's document URL, or undefined when it didn't save. */
  const startUpload = useCallback(
    (id: string): Promise<string | undefined> => {
      const input = uploadInputs.current.get(id);
      if (!input) return Promise.resolve(undefined);
      let saved: string | undefined;
      cancelled.current.delete(id);
      setUploads((items) =>
        items.map((item) => (item.id === id ? { ...item, status: "queued", sent: 0 } : item)),
      );
      return run(
        (s) => s,
        async () => {
          if (cancelled.current.has(id)) return (s) => s;
          setUploads((items) =>
            items.map((item) =>
              item.id === id ? { ...item, status: "uploading", attempt: item.attempt + 1 } : item,
            ),
          );
          const result = (
            await uploadFiles(
              io,
              [{ name: input.name, original: input.file, metadata: input.metadata }],
              {
                encoder: browserEncoder,
                stripLocation: input.stripLocation,
                now: new Date().toISOString(),
                id: () => id,
                onProgress: (_index, percent) =>
                  setUploads((items) =>
                    items.map((item) =>
                      item.id === id ? { ...item, sent: (input.file.size * percent) / 100 } : item,
                    ),
                  ),
              },
            )
          )[0];
          setUploads((items) =>
            items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: result?.ok ? "done" : "failed",
                    ...(result?.ok ? {} : { error: "unknown" as const }),
                  }
                : item,
            ),
          );
          if (!result?.ok)
            toast.error(
              result && !result.ok && statusOf(result.error) === 412
                ? "This upload already exists or changed elsewhere. Your library has been refreshed. Check Photos before retrying."
                : result && !result.ok && result.error instanceof LocationStripError
                  ? result.error.message
                  : `Couldn't upload ${input.name}. Retry in the upload panel.`,
            );
          else {
            saved = result.url;
            announce(`${input.name} uploaded`);
          }
          return (s) => s;
        },
      ).then(() => saved);
    },
    [io, run],
  );
  const upload = useCallback(
    (files: File[], stripLocation: boolean) => {
      const added = files.map((file) => {
        const id = crypto.randomUUID();
        uploadInputs.current.set(id, { file, name: file.name, stripLocation });
        return {
          id,
          name: file.name,
          total: file.size,
          sent: 0,
          status: "queued" as const,
          attempt: 0,
        };
      });
      setUploads((items) => [...items, ...added]);
      for (const item of added) void startUpload(item.id);
    },
    [startUpload],
  );
  /**
   * Uploads a Takeout plan through the upload panel, then files the saved photos
   * into albums (adding to an album of the same name when one exists).
   */
  const importTakeout = useCallback(
    async (plan: TakeoutPlan, stripLocation: boolean) => {
      const added = plan.items.map((item) => {
        const id = crypto.randomUUID();
        uploadInputs.current.set(id, {
          file: item.file,
          name: item.name,
          stripLocation,
          metadata: item.metadata,
        });
        return {
          id,
          name: item.name,
          total: item.file.size,
          sent: 0,
          status: "queued" as const,
          attempt: 0,
        };
      });
      setUploads((items) => [...items, ...added]);
      const saved = new Map<string, string>();
      await Promise.all(
        added.map(async (entry, index) => {
          const url = await startUpload(entry.id);
          const item = plan.items[index] as TakeoutItem;
          if (url) saved.set(item.key, `${url}#it`);
        }),
      );
      let albums = 0;
      for (const album of plan.albums) {
        const refs = album.keys.flatMap((key) => saved.get(key) ?? []);
        if (!refs.length) continue;
        const existing = baseline.current.albums.find((entry) => entry.name === album.title);
        const ok = existing
          ? await editAlbum(
              existing.url,
              (current) => changeMembers(current, refs, true),
              `Added photos to ${album.title}`,
            )
          : await newAlbum(album.title, refs);
        if (ok) albums += 1;
      }
      return { saved: saved.size, failed: plan.items.length - saved.size, albums };
    },
    [startUpload, editAlbum, newAlbum],
  );
  const cancelUpload = (id: string) => {
    // The model's atomic file pipeline cannot be interrupted safely. Queued files
    // can be cancelled; active files finish and remain visible in the library.
    const item = uploads.find((value) => value.id === id);
    if (item?.status === "uploading") {
      toast("This photo is already saving. You can move it to trash after upload.");
      return;
    }
    cancelled.current.add(id);
    setUploads((items) =>
      items.map((value) => (value.id === id ? { ...value, status: "skipped" } : value)),
    );
  };
  const dismissUploads = () => {
    for (const item of uploads)
      if (["done", "failed", "skipped"].includes(item.status)) {
        uploadInputs.current.delete(item.id);
        io.uploads.delete(item.id);
      }
    setUploads((items) =>
      items.filter((item) => !["done", "failed", "skipped"].includes(item.status)),
    );
  };
  return {
    ...snapshot,
    status,
    saving,
    announcement,
    session,
    io,
    refresh,
    newAlbum,
    editAlbum,
    removeAlbum,
    favourite,
    moveToTrash,
    restore,
    resume,
    purge,
    keywords,
    uploads,
    upload,
    importTakeout,
    dismissUploads,
    retryUpload: startUpload,
    cancelUpload,
  };
}
export function PhotosProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const value = usePhotosState(session);
  return <Context value={value}>{children}</Context>;
}
export function usePhotos() {
  const value = useContext(Context);
  if (!value) throw new Error("PhotosProvider is required");
  return value;
}
