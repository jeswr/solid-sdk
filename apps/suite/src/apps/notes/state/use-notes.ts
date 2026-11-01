// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePodSessionState } from "../../../lib/session/pod-session";
import { type NotesPreferences, notesPreferencesSchema } from "../lib/model/prefs";
import { type NotesFilter, selectNotes } from "../lib/model/query";
import type { NotesStore } from "../lib/model/store";

/** Fence overlapping refreshes, unmounts and account/resource switches. */
export function useNotesResource<T>(store: NotesStore, load: () => Promise<T>) {
  const session = usePodSessionState();
  const [state, setState] = useState<{
    owner: typeof load;
    data: T | undefined;
    loading: boolean;
    error: unknown;
  }>({ owner: load, data: undefined, loading: true, error: undefined });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setState((previous) => ({
      owner: load,
      data: previous.owner === load ? previous.data : undefined,
      loading: true,
      error: undefined,
    }));
    try {
      const data = await load();
      if (current === generation.current)
        setState({ owner: load, data, loading: false, error: undefined });
    } catch (error) {
      if (current === generation.current)
        setState({ owner: load, data: undefined, loading: false, error });
    }
  }, [load]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  const subscription = session.status === "ready" ? session.session.subscribe : undefined;
  useEffect(
    () =>
      subscription?.((url) => {
        // Notifications are invalidation hints; only refresh the current store's tree.
        try {
          const changed = new URL(url);
          const root = new URL(store.containers.active);
          if (changed.origin === root.origin && changed.pathname.startsWith(root.pathname))
            void refresh();
        } catch {
          /* Ignore malformed hints. */
        }
      }),
    [subscription, store, refresh],
  );
  return {
    data: state.owner === load ? state.data : undefined,
    loading: state.owner !== load || state.loading,
    error: state.owner === load ? state.error : undefined,
    refresh,
  };
}

const defaults = notesPreferencesSchema.parse({});
export function useNotes(
  store: NotesStore,
  filter: NotesFilter,
  prefs: NotesPreferences = defaults,
) {
  const load = useCallback(() => store.list(filter.location), [store, filter.location]);
  const result = useNotesResource(store, load);
  return { ...result, selected: selectNotes(result.data ?? [], prefs, filter) };
}
