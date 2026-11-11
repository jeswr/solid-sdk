// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { createInboxReader } from "@jeswr/pod-access/notify";
import {
  mergeSharedItems,
  type SharedItem,
  sharedItemsFromInbox,
  visibleSharedItems,
} from "@jeswr/suite-sdk/shared";
import { useEffect, useState } from "react";
import { useDrivePreferences } from "@/apps/drive/state/prefs";
import { sharedProjectsKey } from "@/apps/tasks/state/preferences";
import { parseSharedProjects } from "@/apps/tasks/state/preferences-reducer";
import type { PodSession } from "@/lib/session/pod-session";
import { useHiddenSharedItems } from "./hidden";
import { openedSharedItems } from "./items";

export function useSharedItems(session: PodSession) {
  const [prefs] = useDrivePreferences(session.webId);
  const { hidden, remove } = useHiddenSharedItems(session.webId);
  const [version, setVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    session: PodSession;
    items: SharedItem[];
    projects: SharedItem[];
    error: boolean;
  }>();
  useEffect(() => {
    void version;
    const controller = new AbortController();
    const reader = createInboxReader({
      fetch: (input, init) => {
        controller.signal.throwIfAborted();
        const signal = init?.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal;
        return session.fetch(input, { ...init, signal });
      },
    });
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
            }),
          );
        } catch {
          return [];
        }
      })();
      try {
        const inbox = await reader.inbox(session.webId);
        const items = inbox
          ? sharedItemsFromInbox(await reader.list(inbox, { signal: controller.signal }))
          : [];
        if (!controller.signal.aborted && current === generation)
          setSnapshot({ session, items, projects, error: false });
      } catch {
        if (!controller.signal.aborted && current === generation)
          setSnapshot({ session, items: [], projects, error: true });
      }
    };
    void load();
    const refresh = () => {
      void load();
    };
    const unsubscribe = session.subscribe(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("suite-shared-change", refresh);
    return () => {
      controller.abort();
      unsubscribe();
      window.removeEventListener("storage", refresh);
      window.removeEventListener("suite-shared-change", refresh);
    };
  }, [session, version]);
  const current = snapshot?.session === session ? snapshot : undefined;
  return {
    items: visibleSharedItems(
      mergeSharedItems(
        current?.items ?? [],
        openedSharedItems(prefs.openedShared),
        current?.projects ?? [],
      ),
      hidden,
    ),
    loading: !current,
    error: current?.error ?? false,
    remove,
    refresh: () => setVersion((value) => value + 1),
  };
}
