// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { toast } from "@jeswr/suite-ui";
import { useEffect, useRef, useState } from "react";
import { NoteConflictError } from "../lib/model/errors";
import type { NoteChanges, NotesStore, StoredNote } from "../lib/model/store";

type Projection = (notes: readonly StoredNote[]) => StoredNote[];

/** Pending projections are replayed over the latest confirmed list. Removing a
 * failed intent never restores a stale snapshot or undoes a newer intent.
 * The UI applies project(data) before selecting/filtering its notes.
 */
export function useNotesMutations(store: NotesStore, refresh: () => Promise<unknown>) {
  const [pending, setPending] = useState<{ store: NotesStore; id: symbol; apply: Projection }[]>(
    [],
  );
  const [failure, setFailure] = useState<{ store: NotesStore; error: unknown }>();
  const owner = useRef(store);
  owner.current = store;
  useEffect(() => {
    setPending((items) => items.filter((item) => item.store === store));
    setFailure(undefined);
  }, [store]);
  async function run<T>(apply: Projection, write: () => Promise<T>): Promise<T> {
    const id = Symbol();
    setFailure(undefined);
    setPending((items) => [...items, { store, id, apply }]);
    try {
      const result = await write();
      if (owner.current === store) await refresh();
      return result;
    } catch (error) {
      if (owner.current === store) setFailure({ store, error });
      if (owner.current === store && error instanceof NoteConflictError) {
        toast.error("This note changed somewhere else. The list has been refreshed.");
        await refresh();
      }
      throw error;
    } finally {
      setPending((items) => items.filter((item) => item.id !== id));
    }
  }
  const remove =
    (note: StoredNote): Projection =>
    (notes) =>
      notes.filter((item) => item.url !== note.url);
  return {
    pending: pending.some((item) => item.store === store),
    error: failure?.store === store ? failure.error : undefined,
    project: (notes: readonly StoredNote[]) =>
      pending
        .filter((item) => item.store === store)
        .reduce((data, item) => item.apply(data), [...notes]),
    create: (input: NoteChanges = {}) => {
      const draft: StoredNote = {
        url: `${store.containers.active}pending-${crypto.randomUUID()}.ttl`,
        title: input.title ?? "",
        body: input.body ?? "",
        labels: [...(input.labels ?? [])],
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        format: "text/html",
        location: "active",
        revisions: [],
        etag: null,
      };
      return run(
        (notes) => [draft, ...notes],
        () => store.create(input),
      );
    },
    save: (note: StoredNote, change: NoteChanges) =>
      run(
        (notes) =>
          notes.map((item) =>
            item.url === note.url
              ? { ...item, ...change, labels: change.labels ? [...change.labels] : item.labels }
              : item,
          ),
        () => store.save(note, change, note.etag),
      ),
    archive: (note: StoredNote) => run(remove(note), () => store.archive(note)),
    unarchive: (note: StoredNote) => run(remove(note), () => store.unarchive(note)),
    trash: (note: StoredNote) => run(remove(note), () => store.trash(note)),
    restore: (note: StoredNote) => run(remove(note), () => store.restore(note)),
    deleteForever: (note: StoredNote) =>
      run(remove(note), () => store.deleteForever(note.url, note.etag)),
  };
}
