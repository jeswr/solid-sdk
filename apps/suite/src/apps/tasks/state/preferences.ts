// AUTHORED-BY Codex GPT-6
"use client";
import { useEffect, useSyncExternalStore } from "react";
import {
  defaultPreferences,
  type PreferenceAction,
  parsePreferences,
  preferencesReducer,
} from "./preferences-reducer";

export type { PreferenceAction, TasksPreferences } from "./preferences-reducer";

const KEY = "suite.tasks.prefs";
let snapshot = defaultPreferences;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** Shared across the sidebar and list; browser storage is always optional. */
export function useTasksPreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => defaultPreferences,
  );
  useEffect(() => {
    const read = () => {
      try {
        snapshot = parsePreferences(window.localStorage.getItem(KEY));
        emit();
      } catch {
        /* In-memory preferences still work when storage is disabled. */
      }
    };
    read();
    const change = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) read();
    };
    window.addEventListener("storage", change);
    return () => window.removeEventListener("storage", change);
  }, []);
  const dispatch = (action: PreferenceAction) => {
    snapshot = preferencesReducer(snapshot, action);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(snapshot));
    } catch {
      /* Storage may be full or disabled. */
    }
    emit();
  };
  return { preferences, dispatch };
}
