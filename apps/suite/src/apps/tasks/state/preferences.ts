// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  defaultPreferences,
  type PreferenceAction,
  parsePreferences,
  parseSharedProjects,
  preferencesReducer,
  type TasksPreferences,
} from "./preferences-reducer";

export type { PreferenceAction, TasksPreferences } from "./preferences-reducer";

const KEY = "suite.tasks.prefs";
/** Shared with me is per account: another WebID signing in on this browser never sees it. */
export const sharedProjectsKey = (webId: string) =>
  `suite.tasks.shared:${encodeURIComponent(webId)}`;
let identity: string | undefined;
let snapshot: TasksPreferences = defaultPreferences;
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
/**
 * The signed-in account's Shared with me list. When storage cannot be read, the in-memory list
 * stands in, but only while it belongs to the same account.
 */
function readShared(): TasksPreferences["sharedProjects"] {
  if (!identity) return [];
  try {
    return parseSharedProjects(window.localStorage.getItem(sharedProjectsKey(identity)));
  } catch {
    return snapshot.sharedOwner === identity ? snapshot.sharedProjects : [];
  }
}
/**
 * Bind Shared with me to the signed-in WebID (undefined when signed out). A change of identity
 * replaces the in-memory list with that account's own, so nothing carries across accounts.
 */
export function setPreferencesIdentity(webId: string | undefined) {
  if (webId === identity) return;
  identity = webId;
  snapshot = { ...snapshot, sharedProjects: readShared(), sharedOwner: identity };
  emit();
}
/** Shared across the sidebar and list; browser storage is always optional. */
export function useTasksPreferences() {
  const preferences = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => defaultPreferences,
  );
  useEffect(() => {
    const read = () => {
      let global = snapshot;
      try {
        global = parsePreferences(window.localStorage.getItem(KEY));
      } catch {
        /* In-memory preferences still work when storage is disabled. */
      }
      snapshot = { ...global, sharedProjects: readShared(), sharedOwner: identity };
      emit();
    };
    read();
    const change = (event: StorageEvent) => {
      if (
        event.key === KEY ||
        event.key === null ||
        (identity !== undefined && event.key === sharedProjectsKey(identity))
      )
        read();
    };
    window.addEventListener("storage", change);
    return () => window.removeEventListener("storage", change);
  }, []);
  const dispatch = useCallback((action: PreferenceAction) => {
    const shared = action.type === "sharedProject" || action.type === "removeSharedProject";
    if (shared && !identity) return;
    const next = preferencesReducer(snapshot, action);
    if (next === snapshot) return;
    snapshot = next;
    try {
      if (shared && identity)
        window.localStorage.setItem(
          sharedProjectsKey(identity),
          JSON.stringify(snapshot.sharedProjects),
        );
      else {
        const { sharedProjects: _shared, sharedOwner: _owner, ...global } = snapshot;
        window.localStorage.setItem(KEY, JSON.stringify(global));
      }
    } catch {
      /* Storage may be full or disabled. */
    }
    emit();
  }, []);
  return { preferences, dispatch };
}
