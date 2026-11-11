// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { sharedAccountKey, sharedItemsForAccount } from "@jeswr/suite-sdk/shared";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { clearHiddenSharedForAccount, hideSharedForAccount } from "@/lib/shared/hidden";
import {
  defaultPreferences,
  type PreferenceAction,
  parseFavourites,
  parsePreferences,
  parseSharedProjects,
  preferencesReducer,
  type TasksPreferences,
} from "./preferences-reducer";

export type { PreferenceAction, TasksPreferences } from "./preferences-reducer";

const KEY = "suite.tasks.prefs";
/** Shared with me is per account: another WebID signing in on this browser never sees it. */
export const sharedProjectsKey = (webId: string) => sharedAccountKey(webId, "suite.tasks.shared");
export const favouritesKey = (webId: string) =>
  `suite.tasks.favourites:${encodeURIComponent(webId)}`;
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
    return [
      ...sharedItemsForAccount(identity, {
        owner: snapshot.sharedOwner,
        items: snapshot.sharedProjects,
      }),
    ];
  }
}
function readFavourites(): string[] {
  if (!identity) return [];
  try {
    return parseFavourites(window.localStorage.getItem(favouritesKey(identity)));
  } catch {
    return snapshot.sharedOwner === identity ? snapshot.favourites : [];
  }
}
/**
 * Bind account lists to the signed-in WebID (undefined when signed out). A change of identity
 * replaces the in-memory lists with that account's own, so nothing carries across accounts.
 */
export function setPreferencesIdentity(webId: string | undefined) {
  if (webId === identity) return;
  identity = webId;
  snapshot = {
    ...snapshot,
    sharedProjects: readShared(),
    favourites: readFavourites(),
    sharedOwner: identity,
  };
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
      snapshot = {
        ...global,
        sharedProjects: readShared(),
        favourites: readFavourites(),
        sharedOwner: identity,
      };
      emit();
    };
    read();
    const change = (event: StorageEvent) => {
      if (
        event.key === KEY ||
        event.key === null ||
        (identity !== undefined &&
          (event.key === sharedProjectsKey(identity) || event.key === favouritesKey(identity)))
      )
        read();
    };
    window.addEventListener("storage", change);
    return () => window.removeEventListener("storage", change);
  }, []);
  const owner = preferences.sharedOwner;
  const dispatch = useCallback(
    (action: PreferenceAction) => {
      const shared = action.type === "sharedProject" || action.type === "removeSharedProject";
      const favourite = action.type === "favouriteProject";
      if ((shared || favourite) && !identity) return;
      // A menu callback retained across an account switch cannot write to the new account.
      if ((shared || favourite) && owner !== identity) return;
      if (action.type === "removeSharedProject" && identity) {
        removeSharedProjectForAccount(identity, action.url);
        return;
      }
      const next = preferencesReducer(snapshot, action);
      if (
        action.type === "sharedProject" &&
        identity &&
        next.sharedProjects.some((p) => p.url === action.url)
      )
        clearHiddenSharedForAccount(identity, action.url);
      if (next === snapshot) return;
      snapshot = next;

      try {
        if (shared && identity)
          window.localStorage.setItem(
            sharedProjectsKey(identity),
            JSON.stringify(snapshot.sharedProjects),
          );
        else if (favourite && identity)
          window.localStorage.setItem(favouritesKey(identity), JSON.stringify(snapshot.favourites));
        else {
          const {
            sharedProjects: _shared,
            sharedOwner: _owner,
            favourites: _favourites,
            ...global
          } = snapshot;
          window.localStorage.setItem(KEY, JSON.stringify(global));
        }
      } catch {
        /* Storage may be full or disabled. */
      }
      emit();
      if (shared) window.dispatchEvent(new Event("suite-shared-change"));
    },
    [owner],
  );
  return { preferences, dispatch };
}

/** Notify every mounted Tasks cache before removing its account preference entry. */
const removalListeners = new Set<(owner: string, url: string) => void>();
export function subscribeSharedProjectRemoval(listener: (owner: string, url: string) => void) {
  removalListeners.add(listener);
  return () => {
    removalListeners.delete(listener);
  };
}
export function removeSharedProjectForAccount(owner: string, url: string) {
  for (const listener of removalListeners) listener(owner, url);
  const projects =
    identity === owner
      ? snapshot.sharedProjects
      : (() => {
          try {
            return parseSharedProjects(localStorage.getItem(sharedProjectsKey(owner)));
          } catch {
            return [];
          }
        })();
  const next = preferencesReducer(
    { ...defaultPreferences, sharedProjects: projects },
    { type: "removeSharedProject", url },
  );
  hideSharedForAccount(owner, url);
  if (identity === owner) snapshot = { ...snapshot, sharedProjects: next.sharedProjects };
  try {
    localStorage.setItem(sharedProjectsKey(owner), JSON.stringify(next.sharedProjects));
  } catch {
    /* Account memory remains usable when storage is unavailable. */
  }
  emit();
  window.dispatchEvent(new Event("suite-shared-change"));
}
