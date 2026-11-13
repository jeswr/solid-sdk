// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { ResourceWriteError } from "../../docs/lib/model/errors";
import { NoteConflictError, NotePermissionError } from "../lib/model/errors";
import type { NotesStore, StoredNote } from "../lib/model/store";

export type NoteDraft = Pick<StoredNote, "title" | "body" | "labels"> & {
  /** Persist restore intent so retries also retain the replaced content. */
  preserveCurrent?: boolean | undefined;
};
export interface PendingDraft {
  note: StoredNote;
  draft: NoteDraft;
  status: "saving" | "failed" | "conflict" | "read-only";
}
type Save = NotesStore["save"];
type Listener = (url: string, saved?: StoredNote) => void;

/** No browser globals: persistence and lifecycle events belong to the browser adapter.
 * Entries own their writer beyond a component's lifetime. Persist synchronously BEFORE
 * starting I/O, and remove only the exact snapshot acknowledged by a successful PUT.
 */
export function createPendingDrafts(seams: {
  initial: readonly PendingDraft[];
  persist: (drafts: readonly PendingDraft[]) => void;
  saved?: (url: string) => void;
}) {
  const entries = new Map(seams.initial.map((entry) => [entry.note.url, entry]));
  const writers = new Map<string, Save>();
  const inFlight = new Map<string, Promise<StoredNote>>();
  const listeners = new Set<Listener>();
  const blocked = new Set<string>();
  const changed = (url: string, saved?: StoredNote) => {
    seams.persist([...entries.values()]);
    for (const listener of listeners) listener(url, saved);
  };
  const bind = (note: StoredNote, save: Save) => {
    writers.set(note.url, save);
    const entry = entries.get(note.url);
    if (note.readOnly === true) blocked.add(note.url);
    if (note.readOnly === false) blocked.delete(note.url);
    if (entry && note.readOnly !== undefined && (entry.status === "read-only") !== note.readOnly) {
      entries.set(note.url, {
        ...entry,
        note: { ...entry.note, readOnly: note.readOnly },
        status: note.readOnly ? "read-only" : "saving",
      });
      changed(note.url);
    }
  };
  const flush = (note: StoredNote, save: Save): Promise<StoredNote> => {
    writers.set(note.url, save);
    const running = inFlight.get(note.url);
    if (running) return running;
    const pending = entries.get(note.url);
    if (blocked.has(note.url) || pending?.status === "read-only")
      return Promise.reject(new ResourceWriteError(note.url, 403));
    if (!pending) return Promise.resolve(note);
    if (pending.status === "conflict") return Promise.reject(new NoteConflictError(note.url));
    const drain = async () => {
      let saved = note;
      try {
        while (entries.has(note.url)) {
          if (blocked.has(note.url)) throw new ResourceWriteError(note.url, 403);
          const snapshot = entries.get(note.url) as PendingDraft;
          entries.set(note.url, { ...snapshot, status: "saving" });
          changed(note.url);
          saved = await save(snapshot.note, snapshot.draft, snapshot.note.etag);
          const latest = entries.get(note.url) as PendingDraft;
          if (latest.draft === snapshot.draft) {
            entries.delete(note.url);
            seams.saved?.(note.url);
          } else {
            // A saved restore already kept the replaced content; later edits must not repeat it.
            const { preserveCurrent: _kept, ...rest } = latest.draft;
            const draft = snapshot.draft.preserveCurrent ? rest : latest.draft;
            entries.set(note.url, { ...latest, draft, note: saved });
          }
          changed(note.url, saved);
        }
        return saved;
      } catch (error) {
        const latest = entries.get(note.url) as PendingDraft;
        const forbidden = error instanceof ResourceWriteError && error.status === 403;
        if (forbidden) blocked.add(note.url);
        entries.set(note.url, {
          ...latest,
          ...(forbidden
            ? {
                note: {
                  ...latest.note,
                  readOnly: true,
                  ...(error instanceof NotePermissionError
                    ? { localGeneration: error.localGeneration }
                    : {}),
                },
              }
            : {}),
          status: forbidden
            ? "read-only"
            : error instanceof NoteConflictError
              ? "conflict"
              : "failed",
        });
        changed(note.url);
        throw error;
      }
    };
    const promise = drain();
    inFlight.set(note.url, promise);
    void promise.finally(() => inFlight.delete(note.url)).catch(() => {});
    return promise;
  };
  return {
    get: (url: string) => entries.get(url),
    all: () => [...entries.values()],
    bind,
    restore(entry: PendingDraft) {
      entries.set(entry.note.url, entry);
      changed(entry.note.url);
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    change(note: StoredNote, draft: NoteDraft, save: Save) {
      writers.set(note.url, save);
      if (blocked.has(note.url) || entries.get(note.url)?.status === "read-only") return;
      const existing = entries.get(note.url);
      entries.set(note.url, {
        note: existing?.note ?? note,
        draft: { ...draft, labels: [...draft.labels] },
        status: existing?.status === "conflict" ? "conflict" : "saving",
      });
      changed(note.url);
    },
    flush,
    resolve(latest: StoredNote, keepMine: boolean) {
      if (blocked.has(latest.url) || entries.get(latest.url)?.status === "read-only") return;
      const pending = entries.get(latest.url);
      if (!pending) return;
      if (keepMine) entries.set(latest.url, { ...pending, note: latest, status: "saving" });
      else entries.delete(latest.url);
      changed(latest.url, latest);
    },
    retry() {
      return Promise.allSettled(
        [...entries.values()].flatMap(({ note, status }) => {
          const save = writers.get(note.url);
          return save && status !== "conflict" && status !== "read-only" && !blocked.has(note.url)
            ? [flush(note, save)]
            : [];
        }),
      );
    },
    beforeUnload(event: Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">) {
      if (!entries.size) return;
      event.preventDefault();
      event.returnValue = "";
    },
  };
}
export type PendingDrafts = ReturnType<typeof createPendingDrafts>;
