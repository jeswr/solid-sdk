// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useCallback, useEffect, useState } from "react";
import { type NotesPreferences, notesPreferencesSchema } from "../lib/model/prefs";

const defaults = notesPreferencesSchema.parse({});
const listeners = new Set<() => void>();
const unsaved = new Map<string, NotesPreferences>();
const keyFor = (webId: string) => `suite.notes.prefs.${webId}`;

function load(webId: string): NotesPreferences {
  const memory = unsaved.get(webId);
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(keyFor(webId));
    return raw ? notesPreferencesSchema.parse(JSON.parse(raw)) : defaults;
  } catch {
    return defaults;
  }
}

export function useNotesPreferences(webId: string) {
  const [state, setState] = useState({ webId, prefs: defaults });
  useEffect(() => {
    const sync = () => setState({ webId, prefs: load(webId) });
    sync();
    listeners.add(sync);
    const onStorage = (event: StorageEvent) => {
      if (event.key === keyFor(webId) || event.key === null) sync();
    };
    addEventListener("storage", onStorage);
    return () => {
      listeners.delete(sync);
      removeEventListener("storage", onStorage);
    };
  }, [webId]);
  const update = useCallback(
    (change: (prefs: NotesPreferences) => NotesPreferences) => {
      const prefs = notesPreferencesSchema.parse(change(load(webId)));
      try {
        localStorage.setItem(keyFor(webId), JSON.stringify(prefs));
        unsaved.delete(webId);
      } catch {
        unsaved.set(webId, prefs);
      }
      setState({ webId, prefs });
      for (const listener of listeners) listener();
    },
    [webId],
  );
  return [state.webId === webId ? state.prefs : defaults, update] as const;
}
