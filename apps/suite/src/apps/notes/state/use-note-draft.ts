// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast } from "@jeswr/suite-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { NoteConflictError } from "../lib/model/errors";
import type { NoteChanges, NotesStore, StoredNote } from "../lib/model/store";

/** One writer per open dialog. Edits arriving during a PUT are saved by the same drain loop. */
export function useNoteDraft(note: StoredNote, store: NotesStore, onSaved: () => Promise<unknown>) {
  const [draft, setDraft] = useState({ title: note.title, body: note.body, labels: note.labels });
  const current = useRef(draft);
  const baseline = useRef(note);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const inFlight = useRef<Promise<StoredNote> | undefined>(undefined);
  const blocked = useRef(false);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const [status, setStatus] = useState<"saved" | "saving" | "failed" | "conflict">("saved");
  const [modified, setModified] = useState(note.modified ?? note.created);
  const flush = useCallback((): Promise<StoredNote> => {
    if (inFlight.current) return inFlight.current;
    if (blocked.current) return Promise.reject(new NoteConflictError(baseline.current.url));
    const drain = async () => {
      try {
        while (savedVersion.current !== version.current) {
          setStatus("saving");
          const snapshot = current.current;
          const saving = version.current;
          const saved = await store.save(baseline.current, snapshot, baseline.current.etag);
          baseline.current = saved;
          savedVersion.current = saving;
          setModified(saved.modified);
          void callback.current();
        }
        setStatus("saved");
        return baseline.current;
      } catch (error) {
        blocked.current = error instanceof NoteConflictError;
        setStatus(blocked.current ? "conflict" : "failed");
        throw error;
      }
    };
    const promise = drain();
    inFlight.current = promise;
    void promise
      .finally(() => {
        if (inFlight.current === promise) inFlight.current = undefined;
      })
      .catch(() => {});
    return promise;
  }, [store]);
  const change = (patch: NoteChanges) => {
    const next = {
      ...current.current,
      ...patch,
      labels: patch.labels ? [...patch.labels] : current.current.labels,
    };
    current.current = next;
    version.current++;
    setDraft(next);
    if (!blocked.current) setStatus("saving");
  };
  // A failed write stays available for an explicit retry; a new edit restarts its debounce.
  // biome-ignore lint/correctness/useExhaustiveDependencies: every draft edit restarts the debounce
  useEffect(() => {
    if (status !== "saving") return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, status, flush]);
  useEffect(() => {
    const save = () => {
      void flush().catch(() => {});
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") save();
    };
    addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", hidden);
      if (savedVersion.current !== version.current)
        void flush().catch(() =>
          toast.error("Couldn't save your last edits", {
            action: { label: "Retry", onClick: save },
          }),
        );
    };
  }, [flush]);
  const resolve = async (keepMine: boolean) => {
    try {
      const latest = await store.read(baseline.current.url);
      if (!latest) throw new Error("Missing note");
      baseline.current = latest;
      blocked.current = false;
      if (!keepMine) {
        const value = { title: latest.title, body: latest.body, labels: latest.labels };
        current.current = value;
        savedVersion.current = ++version.current;
        setDraft(value);
        setModified(latest.modified);
        setStatus("saved");
        void callback.current();
      } else await flush();
    } catch {
      setStatus(blocked.current ? "conflict" : "failed");
    }
  };
  return { draft, change, flush, resolve, status, modified };
}
