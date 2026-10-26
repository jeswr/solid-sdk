// AUTHORED-BY Claude Opus 5.5
"use client";

/**
 * Drive's client state: the storage client for the active account, the
 * resolved Drive root, preferences, live folder listings and the upload
 * queue. Screens read it through {@link useDrive} and {@link useFolder}.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ensureTypeRegistrations } from "@/apps/docs/lib/model/type-index";
import type { PodSession } from "@/lib/session/pod-session";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
  type DriveItem,
  parentOf,
} from "../lib/client/client";
import { DRIVE_ROOT_CLASS } from "../lib/constants";
import { type DrivePreferences, useDrivePreferences } from "./prefs";
import { type UploadQueue, useUploadQueue } from "./uploads";

export interface DriveContextValue {
  readonly session: PodSession;
  readonly client: DriveClient;
  /** `undefined` while the root is being resolved. */
  readonly driveRoot: string | undefined;
  readonly rootError: unknown;
  readonly prefs: DrivePreferences;
  readonly updatePrefs: (change: (current: DrivePreferences) => DrivePreferences) => void;
  readonly uploads: UploadQueue;
  /** Bumped for a folder URL whenever something inside it changes. */
  readonly changes: { subscribe(folder: string, listener: () => void): () => void };
  /** Force a re-list of a folder (and its parent). */
  readonly invalidate: (url: string) => void;
}

const DriveContext = createContext<DriveContextValue | undefined>(undefined);

async function resolveDriveRoot(client: DriveClient, session: PodSession): Promise<string> {
  const root = `${session.storageUrl}drive/`;
  try {
    await client.createFolder(root);
  } catch (error) {
    if (!(error instanceof DriveError && error.kind === "conflict")) throw error;
  }
  // Register the root so other apps (and Drive on another device) find it.
  await ensureTypeRegistrations({
    webId: session.webId,
    podRoot: session.storageUrl,
    registrations: [{ forClass: DRIVE_ROOT_CLASS, container: root }],
    fetchImpl: session.fetch,
  });
  return root;
}

export function DriveProvider({ session, children }: { session: PodSession; children: ReactNode }) {
  const client = useMemo(
    () => createSolidDriveClient({ storageUrl: session.storageUrl, fetch: session.fetch }),
    [session],
  );
  const [driveRoot, setDriveRoot] = useState<string>();
  const [rootError, setRootError] = useState<unknown>();
  const [prefs, updatePrefs] = useDrivePreferences(session.webId);
  const listeners = useRef(new Map<string, Set<() => void>>());

  const invalidate = useCallback((url: string) => {
    const notify = (folder: string | undefined) => {
      if (!folder) return;
      for (const listener of listeners.current.get(folder) ?? []) listener();
    };
    notify(url.endsWith("/") ? url : undefined);
    notify(parentOf(url));
  }, []);

  useEffect(() => session.subscribe((url) => invalidate(url)), [session, invalidate]);

  useEffect(() => {
    let live = true;
    resolveDriveRoot(client, session).then(
      (root) => live && setDriveRoot(root),
      (error: unknown) => live && setRootError(error),
    );
    return () => {
      live = false;
    };
  }, [client, session]);

  const uploads = useUploadQueue(client, invalidate);

  const value = useMemo<DriveContextValue>(
    () => ({
      session,
      client,
      driveRoot,
      rootError,
      prefs,
      updatePrefs,
      uploads,
      invalidate,
      changes: {
        subscribe(folder, listener) {
          const set = listeners.current.get(folder) ?? new Set();
          set.add(listener);
          listeners.current.set(folder, set);
          return () => set.delete(listener);
        },
      },
    }),
    [session, client, driveRoot, rootError, prefs, updatePrefs, uploads, invalidate],
  );
  return <DriveContext value={value}>{children}</DriveContext>;
}

export function useDrive(): DriveContextValue {
  const value = useContext(DriveContext);
  if (!value) throw new Error("useDrive outside DriveProvider");
  return value;
}

export type FolderState =
  | { status: "loading" }
  | { status: "ready"; items: DriveItem[]; refreshing: boolean }
  | { status: "error"; error: unknown };

/** A live listing of a folder: reloads when anything inside it changes. */
export function useFolder(url: string | undefined): FolderState & { reload: () => void } {
  const { client, changes } = useDrive();
  const [state, setState] = useState<FolderState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!url) return;
    return changes.subscribe(url, reload);
  }, [url, changes, reload]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces a re-list
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState((current) =>
      current.status === "ready" ? { ...current, refreshing: true } : { status: "loading" },
    );
    client.list(url, { signal: controller.signal }).then(
      (items) => setState({ status: "ready", items, refreshing: false }),
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", error });
      },
    );
    return () => controller.abort();
  }, [url, client, tick]);
  return { ...state, reload };
}
