// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { BookmarkData } from "@jeswr/solid-bookmark";
import type { BookmarkPatch, BookmarkRepository, StoredBookmark } from "@jeswr/solid-bookmark/pod";
import type { BookmarkItem } from "../lib/library";

type Change =
  | { kind: "add"; items: BookmarkItem[] }
  | { kind: "edit"; ids: string[]; patch: BookmarkPatch }
  | { kind: "tag"; ids: string[]; tag: string }
  | { kind: "remove"; ids: string[] };
export interface LibrarySnapshot {
  items: BookmarkItem[];
  status: "loading" | "ready" | "error";
  error: unknown;
  saving: number;
}
export function createLibraryStore(
  repository: BookmarkRepository,
  onFailure: (error: unknown) => void,
) {
  const confirmed = new Map<string, StoredBookmark>();
  const pending: Change[] = [];
  const listeners = new Set<() => void>();
  let snapshot: LibrarySnapshot = { items: [], status: "loading", error: null, saving: 0 };
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
    };
    for (const listener of listeners) listener();
  };
  const load = async () => {
    const read = ++readGeneration;
    const started = generation;
    try {
      const records = await repository.list();
      if (disposed || read !== readGeneration || started !== generation || pending.length) return;
      const knownIds = new Map([...confirmed].map(([id, record]) => [record.url, id]));
      confirmed.clear();
      for (const record of records) confirmed.set(knownIds.get(record.url) ?? record.url, record);
      snapshot = { ...snapshot, status: "ready", error: null };
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
  const enqueue = (change: Change): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (change.kind === "edit" || change.kind === "tag") {
      const edit = change;
      change.ids = change.ids.filter((id) => {
        const data = snapshot.items.find((item) => item.id === id)?.data;
        return (
          data &&
          Object.entries(patchFor(edit, data)).some(
            ([key, value]) =>
              JSON.stringify(data[key as keyof BookmarkData]) !== JSON.stringify(value),
          )
        );
      });
      if (!change.ids.length) return Promise.resolve();
    }
    generation++;
    pending.push(change);
    publish();
    const run = async () => {
      if (disposed) return;
      let failure: unknown;
      const ids = change.kind === "add" ? change.items.map((item) => item.id) : change.ids;
      for (const id of ids) {
        if (disposed) return;
        const record = confirmed.get(id);
        try {
          if (change.kind === "add") {
            // Undo of a failed delete already exists in the confirmed collection.
            const item = change.items.find((item) => item.id === id) as BookmarkItem;
            if (!record) confirmed.set(id, await repository.create(item.data));
          } else if (record) {
            if (change.kind === "remove") {
              await repository.remove(record);
              confirmed.delete(id);
            } else
              confirmed.set(id, await repository.update(record, patchFor(change, record.data)));
          }
        } catch (error) {
          failure = error;
        }
      }
      pending.splice(pending.indexOf(change), 1);
      publish();
      if (failure && !disposed) onFailure(failure);
    };
    const task = queue.then(run);
    queue = task.catch(onFailure);
    return task;
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
    edit: (ids: string[], patch: BookmarkPatch) => enqueue({ kind: "edit", ids, patch }),
    tag: (ids: string[], raw: string) => {
      const tag = raw.trim();
      return tag ? enqueue({ kind: "tag", ids, tag }) : Promise.resolve();
    },
    remove(ids: string[]) {
      const removed = snapshot.items.filter((item) => ids.includes(item.id));
      void enqueue({ kind: "remove", ids });
      return () => {
        void enqueue({ kind: "add", items: removed });
      };
    },
    settled: () => queue,
    dispose() {
      disposed = true;
      readGeneration++;
      listeners.clear();
    },
  };
}
export type LibraryStore = ReturnType<typeof createLibraryStore>;
