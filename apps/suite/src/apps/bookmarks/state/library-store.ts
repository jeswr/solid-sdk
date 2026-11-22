// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import type { BookmarkData } from "@jeswr/solid-bookmark";
import {
  type BookmarkListing,
  type BookmarkPatch,
  BookmarkPrivacyError,
  type BookmarkRegistrationStatus,
  type BookmarkRepository,
  type StoredBookmark,
} from "@jeswr/solid-bookmark/pod";
import { StorageError } from "@jeswr/storage-client";
import type { BookmarkItem } from "../lib/library";

type Change =
  | { kind: "add"; items: BookmarkItem[]; importing?: boolean }
  | { kind: "edit"; ids: string[]; patch: BookmarkPatch; opening: BookmarkData | undefined }
  | { kind: "tag"; ids: string[]; tag: string }
  | { kind: "remove"; ids: string[] };
export interface LibrarySnapshot {
  items: BookmarkItem[];
  status: "loading" | "ready" | "error";
  error: unknown;
  saving: number;
  skipped: BookmarkListing["skipped"];
  registration: BookmarkRegistrationStatus;
  importRemaining: number;
}
export const BOOKMARK_UNDO_MS = 8000;
const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const editConflict = () =>
  new Error(
    "This bookmark changed while you were editing it. Reopen it to review the latest version.",
  );
const matchesOpening = (
  data: BookmarkData | undefined,
  patch: BookmarkPatch,
  opening: BookmarkData,
) =>
  data &&
  (Object.keys(patch) as (keyof BookmarkPatch)[]).every((key) =>
    sameValue(data[key], opening[key]),
  );
const stopsBatch = (error: unknown) =>
  error instanceof BookmarkPrivacyError ||
  (error instanceof StorageError &&
    ["unauthenticated", "forbidden", "rate-limited"].includes(error.code));

export function createLibraryStore(
  repository: BookmarkRepository,
  onFailure: (error: unknown) => void,
) {
  const confirmed = new Map<string, StoredBookmark>();
  const pending: Change[] = [];
  const deleteTimers = new Set<ReturnType<typeof setTimeout>>();
  const remainingImports = new Map<string, BookmarkItem>();
  const listeners = new Set<() => void>();
  let snapshot: LibrarySnapshot = {
    items: [],
    skipped: [],
    registration: repository.registration,
    status: "loading",
    error: null,
    saving: 0,
    importRemaining: 0,
  };
  let queue = Promise.resolve();
  let generation = 0;
  let readGeneration = 0;
  let disposed = false;
  const patchFor = (
    change: Extract<Change, { kind: "edit" | "tag" }>,
    data: BookmarkData,
  ): BookmarkPatch =>
    change.kind === "edit"
      ? change.patch
      : { tags: [...new Set([...(data.tags ?? []), change.tag])].sort() };
  const publish = () => {
    if (disposed) return;
    const items = new Map<string, BookmarkData>(
      [...confirmed].map(([id, record]) => [id, record.data]),
    );
    for (const change of pending) {
      if (change.kind === "add") for (const item of change.items) items.set(item.id, item.data);
      else
        for (const id of change.ids) {
          const data = items.get(id);
          if (change.kind === "remove") items.delete(id);
          else if (data) items.set(id, { ...data, ...patchFor(change, data) });
        }
    }
    snapshot = {
      ...snapshot,
      items: [...items].map(([id, data]) => ({ id, data })),
      saving: pending.length,
      importRemaining: remainingImports.size,
      registration: repository.registration,
    };
    for (const listener of listeners) listener();
  };
  const load = async () => {
    const read = ++readGeneration;
    const started = generation;
    try {
      const { items: records, skipped } = await repository.list();
      if (disposed || read !== readGeneration || started !== generation || pending.length) return;
      const knownIds = new Map([...confirmed].map(([id, record]) => [record.url, id]));
      confirmed.clear();
      for (const record of records) confirmed.set(knownIds.get(record.url) ?? record.url, record);
      snapshot = { ...snapshot, skipped, status: "ready", error: null };
      publish();
    } catch (error) {
      if (disposed || read !== readGeneration || started !== generation) return;
      // Access failures never leave previously read private content on screen.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["forbidden", "unauthenticated"].includes(String(error.code))
      )
        confirmed.clear();
      snapshot = { ...snapshot, status: "error", error };
      publish();
    }
  };
  const addPending = (change: Change) => {
    generation++;
    pending.push(change);
    publish();
  };
  const finishPending = (change: Change) => {
    generation++;
    pending.splice(pending.indexOf(change), 1);
    publish();
  };
  const schedule = (change: Change): Promise<void> => {
    const run = async () => {
      if (disposed) return;
      let failure: unknown;
      const ids = change.kind === "add" ? change.items.map((item) => item.id) : change.ids;
      for (const [position, id] of ids.entries()) {
        if (disposed) return;
        const record = confirmed.get(id);
        try {
          if (change.kind === "add") {
            const item = change.items[position] as BookmarkItem;
            if (!record) confirmed.set(id, await repository.create(item.data));
            remainingImports.delete(id);
          } else {
            if (
              change.kind === "edit" &&
              change.opening &&
              !matchesOpening(record?.data, change.patch, change.opening)
            )
              throw editConflict();
            if (!record) continue;
            if (change.kind === "remove") {
              await repository.remove(record);
              confirmed.delete(id);
            } else
              confirmed.set(id, await repository.update(record, patchFor(change, record.data)));
          }
        } catch (error) {
          failure = error;
          if (stopsBatch(error)) break;
        }
      }
      finishPending(change);
      if (failure && !disposed) onFailure(failure);
    };
    const task = queue.then(run);
    queue = task.catch(onFailure);
    return task;
  };
  const enqueue = (change: Change): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (change.kind === "edit" || change.kind === "tag") {
      const edit = change;
      change.ids = change.ids.filter((id) => {
        const data = snapshot.items.find((item) => item.id === id)?.data;
        if (edit.kind === "edit" && edit.opening && !matchesOpening(data, edit.patch, edit.opening))
          throw editConflict();
        return (
          data &&
          Object.entries(patchFor(edit, data)).some(
            ([key, value]) => !sameValue(data[key as keyof BookmarkData], value),
          )
        );
      });
      if (!change.ids.length) return Promise.resolve();
    }
    if (change.kind === "add" && change.importing)
      for (const item of change.items) remainingImports.set(item.id, item);
    addPending(change);
    return schedule(change);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    add: (items: BookmarkItem[]) => enqueue({ kind: "add", items }),
    importBookmarks: (items: BookmarkItem[]) => enqueue({ kind: "add", items, importing: true }),
    retryImport: () => {
      if (pending.some((change) => change.kind === "add" && change.importing))
        return Promise.resolve();
      return enqueue({ kind: "add", items: [...remainingImports.values()], importing: true });
    },
    edit: (ids: string[], patch: BookmarkPatch, opening?: BookmarkData) =>
      enqueue({ kind: "edit", ids, patch, opening }),
    tag: (ids: string[], raw: string) => {
      const tag = raw.trim();
      return tag ? enqueue({ kind: "tag", ids, tag }) : Promise.resolve();
    },
    remove(ids: string[], onCommit: () => void) {
      if (disposed) return () => {};
      const change: Change = { kind: "remove", ids };
      addPending(change);
      const timer = setTimeout(() => {
        deleteTimers.delete(timer);
        void schedule(change);
        onCommit();
      }, BOOKMARK_UNDO_MS);
      deleteTimers.add(timer);
      return () => {
        if (!deleteTimers.delete(timer)) return;
        clearTimeout(timer);
        finishPending(change);
      };
    },
    settled: () => queue,
    dispose() {
      disposed = true;
      readGeneration++;
      for (const timer of deleteTimers) clearTimeout(timer);
      deleteTimers.clear();
      remainingImports.clear();
      listeners.clear();
    },
  };
}
export type LibraryStore = ReturnType<typeof createLibraryStore>;
