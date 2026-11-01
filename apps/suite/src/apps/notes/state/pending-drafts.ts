// AUTHORED-BY Codex GPT-6
import { NoteConflictError } from "../lib/model/errors";
import type { NotesStore, StoredNote } from "../lib/model/store";

export type NoteDraft = Pick<StoredNote, "title" | "body" | "labels">;
export interface PendingDraft {
  note: StoredNote;
  draft: NoteDraft;
  status: "saving" | "failed" | "conflict";
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
  const changed = (url: string, saved?: StoredNote) => {
    seams.persist([...entries.values()]);
    for (const listener of listeners) listener(url, saved);
  };
  const bind = (note: StoredNote, save: Save) => writers.set(note.url, save);
  const flush = (note: StoredNote, save: Save): Promise<StoredNote> => {
    bind(note, save);
    const running = inFlight.get(note.url);
    if (running) return running;
    const pending = entries.get(note.url);
    if (!pending) return Promise.resolve(note);
    if (pending.status === "conflict") return Promise.reject(new NoteConflictError(note.url));
    const drain = async () => {
      let saved = note;
      try {
        while (entries.has(note.url)) {
          const snapshot = entries.get(note.url) as PendingDraft;
          entries.set(note.url, { ...snapshot, status: "saving" });
          changed(note.url);
          saved = await save(snapshot.note, snapshot.draft, snapshot.note.etag);
          const latest = entries.get(note.url) as PendingDraft;
          if (latest.draft === snapshot.draft) {
            entries.delete(note.url);
            seams.saved?.(note.url);
          } else entries.set(note.url, { ...latest, note: saved });
          changed(note.url, saved);
        }
        return saved;
      } catch (error) {
        const latest = entries.get(note.url) as PendingDraft;
        entries.set(note.url, {
          ...latest,
          status: error instanceof NoteConflictError ? "conflict" : "failed",
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
      bind(note, save);
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
          return save && status !== "conflict" ? [flush(note, save)] : [];
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
