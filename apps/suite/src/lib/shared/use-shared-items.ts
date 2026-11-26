// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  mergeSharedItems,
  readSharedInbox,
  type SharedInboxFailure,
  type SharedItem,
  sharedHiddenAt,
  sharedItemsFromInbox,
  visibleSharedItems,
} from "@jeswr/suite-sdk/shared";
import { NS } from "@jeswr/suite-vocab";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { drivePreferencesKey, useDrivePreferences } from "@/apps/drive/state/prefs";
import { removeSharedProjectForAccount, sharedProjectsKey } from "@/apps/tasks/state/preferences";
import { parseSharedProjects } from "@/apps/tasks/state/preferences-reducer";
import type { PodSession } from "@/lib/session/pod-session";
import { useHiddenSharedItems } from "./hidden";
import { openedSharedItems } from "./items";

export function useSharedItems(session: PodSession) {
  const active = useRef<PodSession | null>(null);
  useLayoutEffect(() => {
    active.current = session;
    return () => {
      active.current = null;
    };
  }, [session]);
  const [prefs] = useDrivePreferences(session.webId);
  const { hidden, remove } = useHiddenSharedItems(session.webId);
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    session: PodSession;
    items: SharedItem[];
    projects: SharedItem[];
    /** Why the inbox could not be read; absent when it was read (even if empty). */
    failure?: SharedInboxFailure;
    /** The inbox is larger than the bound read: older announcements may be missing. */
    truncated?: { limit: number };
  }>();
  useEffect(() => {
    void version;
    const controller = new AbortController();
    const transport =
      (fetchImpl: typeof fetch): typeof fetch =>
      (input, init) => {
        controller.signal.throwIfAborted();
        const signal = init?.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal;
        return fetchImpl(input, { ...init, signal });
      };
    // Credentials only reach the user's storage; a WebID elsewhere is read credential-free.
    const publicFetch = session.mode === "demo" ? undefined : session.publicFetch;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      const projects = (() => {
        try {
          return parseSharedProjects(localStorage.getItem(sharedProjectsKey(session.webId))).map(
            (project): SharedItem => ({
              url: project.url,
              name: project.title,
              app: "tasks",
              kind: "task-list",
              source: "app",
              rdfTypes: [`${NS.WF}Tracker`],
            }),
          );
        } catch {
          return [];
        }
      })();
      try {
        const result = await readSharedInbox({
          webId: session.webId,
          storageUrl: session.storageUrl,
          fetch: transport(session.fetch),
          ...(publicFetch ? { publicFetch: transport(publicFetch) } : {}),
          signal: controller.signal,
        });
        const items =
          result.status === "ok"
            ? sharedItemsFromInbox(result.notifications, { storageUrl: session.storageUrl })
            : [];
        if (!controller.signal.aborted && current === generation)
          setSnapshot({
            session,
            items,
            projects,
            ...(result.status === "failed" ? { failure: result.reason } : {}),
            ...(result.status === "ok" && result.truncated
              ? { truncated: { limit: result.limit } }
              : {}),
          });
      } catch {
        if (!controller.signal.aborted && current === generation)
          setSnapshot({ session, items: [], projects, failure: "network" });
      }
    };
    void load();
    const refresh = () => {
      void load();
    };
    const unsubscribe = session.subscribe(refresh);
    const storageChange = (event: StorageEvent) => {
      if (
        event.key === sharedProjectsKey(session.webId) ||
        event.key === drivePreferencesKey(session.webId)
      )
        refresh();
    };
    window.addEventListener("storage", storageChange);
    window.addEventListener("suite-shared-change", refresh);
    return () => {
      controller.abort();
      unsubscribe();
      window.removeEventListener("storage", storageChange);
      window.removeEventListener("suite-shared-change", refresh);
    };
  }, [session, version]);
  const current = snapshot?.session === session ? snapshot : undefined;
  const merged = mergeSharedItems(
    current?.items ?? [],
    openedSharedItems(prefs.openedShared),
    current?.projects ?? [],
  );
  return {
    items: visibleSharedItems(merged, hidden),
    loading: !current,
    error: current?.failure !== undefined,
    failure: current?.failure,
    truncated: current?.truncated,
    storageUrl: session.storageUrl,
    remove: (url: string) => {
      if (active.current !== session) return;
      // Tasks owns the forget + preference removal flow for its own Shared with me list only;
      // every other record, whatever its app label, is a local hide.
      if (current?.projects.some((project) => project.url === url))
        removeSharedProjectForAccount(session.webId, url);
      else remove(url, sharedHiddenAt(merged.find((item) => item.url === url)));
    },
    refresh: () => setVersion((value) => value + 1),
  };
}
