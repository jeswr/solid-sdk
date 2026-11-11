// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { NoteConflictError } from "../lib/model/errors";
import type { NotesStore, StoredNote } from "../lib/model/store";
import type { DraftRegistry } from "./draft-registry";
import type { NoteDraft, PendingDrafts } from "./pending-drafts";

/** The shared registry owns the writer; this hook only owns the visible draft and debounce. */
export function useNoteDraft(
  note: StoredNote,
  store: NotesStore,
  onSaved: () => Promise<unknown>,
  pending: PendingDrafts & Partial<Pick<DraftRegistry, "recover">>,
) {
  const baseline = useRef(pending.get(note.url)?.note ?? note);
  const superseded = useRef(new Set<string | null>());
  const adopt = useCallback((saved: StoredNote) => {
    if (baseline.current.etag !== saved.etag) superseded.current.add(baseline.current.etag);
    baseline.current = saved;
  }, []);
  const [draft, setDraft] = useState<NoteDraft>(
    () =>
      pending.get(note.url)?.draft ?? { title: note.title, body: note.body, labels: note.labels },
  );
  const current = useRef(draft);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const [status, setStatus] = useState<"saved" | "saving" | "failed" | "conflict">(
    pending.get(note.url)?.status ?? "saved",
  );
  const [modified, setModified] = useState(note.modified ?? note.created);
  useEffect(() => {
    // A refreshed resource can acknowledge a card/other writer's non-text save.
    // The store stamps request starts and acknowledged writes with local generations.
    // RDF modification dates may move backwards when another client's clock is slow.
    // Never replace a durable dirty draft or an in-flight writer's baseline.
    if (
      pending.get(note.url) ||
      superseded.current.has(note.etag) ||
      (note.localGeneration !== undefined &&
        baseline.current.localGeneration !== undefined &&
        note.localGeneration < baseline.current.localGeneration)
    )
      return;
    adopt(note);
    const value = { title: note.title, body: note.body, labels: note.labels };
    current.current = value;
    setDraft(value);
    setModified(note.modified ?? note.created);
  }, [note, pending, adopt]);
  const save = useCallback<NotesStore["save"]>((...args) => store.save(...args), [store]);
  const flush = useCallback(() => pending.flush(baseline.current, save), [pending, save]);
  useEffect(() => {
    pending.bind(baseline.current, save);
    const unsubscribe = pending.subscribe((url, saved) => {
      if (url !== note.url) return;
      const entry = pending.get(url);
      if (saved) {
        adopt(saved);
        setModified(saved.modified);
        void callback.current();
      }
      const value = entry?.draft ?? {
        title: baseline.current.title,
        body: baseline.current.body,
        labels: baseline.current.labels,
      };
      current.current = value;
      setDraft(value);
      setStatus(entry?.status ?? "saved");
    });
    void pending.recover?.(baseline.current, async (input) => {
      const recovered = await store.create(input);
      void callback.current();
      return recovered;
    });
    return () => {
      unsubscribe();
      // change() already handed off and durably recorded the latest snapshot synchronously.
      // This writer stays alive after unmount and uses each acknowledged ETag in order.
      void flush().catch(() => {});
    };
  }, [pending, save, flush, note.url, store, adopt]);
  const change = (patch: Partial<NoteDraft>) => {
    pending.change(
      baseline.current,
      { ...current.current, ...patch, labels: [...(patch.labels ?? current.current.labels)] },
      save,
    );
  };
  // A failed write waits for Retry or reconnect; edits restart the debounce.
  // biome-ignore lint/correctness/useExhaustiveDependencies: every draft edit restarts the debounce
  useEffect(() => {
    if (status !== "saving") return;
    const timer = setTimeout(() => void flush().catch(() => {}), 800);
    return () => clearTimeout(timer);
  }, [draft, status, flush]);
  const resolve = async (keepMine: boolean) => {
    try {
      const latest = await store.read(baseline.current.url);
      if (!latest) throw new Error("Missing note");
      adopt(latest);
      pending.resolve(latest, keepMine);
      if (keepMine) await flush();
    } catch (error) {
      setStatus(
        error instanceof NoteConflictError || pending.get(note.url)?.status === "conflict"
          ? "conflict"
          : "failed",
      );
    }
  };
  // Non-draft actions run after flush while the editor is locked. Adopt their
  // acknowledged resource before another text edit can start a conditional write.
  const accept = (saved: StoredNote) => {
    adopt(saved);
    setModified(saved.modified);
  };
  return { draft, change, flush, resolve, accept, status, modified };
}
