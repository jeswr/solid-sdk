// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";

/**
 * Drive's client state: the storage client for the active account, the
 * resolved Drive root, preferences, live folder listings and the upload
 * queue. Screens read it through {@link useDrive} and {@link useFolder}.
 */

import { toast } from "@jeswr/suite-ui";
import { termsEqual } from "@jeswr/suite-vocab";
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
import {
  discoverProfileRegistrations,
  ensureTypeRegistrations,
} from "@/apps/docs/lib/model/type-index";
import type { PodSession } from "@/lib/session/pod-session";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
  type DriveItem,
  nameOf,
  parentOf,
} from "../lib/client/client";
import { DRIVE_ROOT_CLASS } from "../lib/constants";
import { useAccessConfirmation } from "./access-confirmation";
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
  readonly changes: {
    subscribe(folder: string, listener: () => void): () => void;
    subscribeSubtree(root: string, listener: () => void): () => void;
  };
  /** Revalidate a resource, its parent and any open descendant listings/metadata. */
  readonly invalidate: (url: string) => void;
}

const DriveContext = createContext<DriveContextValue | undefined>(undefined);

export class DriveRootDiscoveryError extends Error {
  constructor(cause: unknown) {
    super("Can't read your Drive type index. Check your access and retry.", { cause });
  }
}

async function resolveDriveRoot(client: DriveClient, session: PodSession): Promise<string> {
  try {
    const locations = await discoverProfileRegistrations(
      session.webId,
      session.fetch,
      session.storageUrl,
    );
    // Reuse the first DriveRoot container in discovery order (public, then private).
    // A DriveRoot can also be registered as an instance of the root container.
    // Resource instances without a trailing slash cannot serve as a folder.
    const existing = locations.find(
      (location) =>
        termsEqual(location.forClass, DRIVE_ROOT_CLASS) &&
        (location.container || location.instance?.endsWith("/")),
    );
    const root = existing?.container ?? existing?.instance;
    if (root) return root;
  } catch (cause) {
    throw new DriveRootDiscoveryError(cause);
  }
  const root = `${session.storageUrl}drive/`;
  try {
    await client.createFolder(root, { kind: "inherit-verified" });
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
  const { confirmAccess, dialog } = useAccessConfirmation();
  const [driveRoot, setDriveRoot] = useState<string>();
  const [rootError, setRootError] = useState<unknown>();
  const [prefs, updatePrefs] = useDrivePreferences(session.webId);
  const listeners = useRef(new Map<string, Set<() => void>>());
  const subtreeListeners = useRef(new Map<string, Set<() => void>>());
  const changes = useMemo<DriveContextValue["changes"]>(
    () => ({
      subscribe(folder, listener) {
        const set = listeners.current.get(folder) ?? new Set();
        set.add(listener);
        listeners.current.set(folder, set);
        return () => set.delete(listener);
      },
      subscribeSubtree(root, listener) {
        const set = subtreeListeners.current.get(root) ?? new Set();
        set.add(listener);
        subtreeListeners.current.set(root, set);
        return () => {
          set.delete(listener);
          if (set.size === 0) subtreeListeners.current.delete(root);
        };
      },
    }),
    [],
  );

  const invalidate = useCallback((url: string) => {
    const notify = (folder: string | undefined) => {
      if (!folder) return;
      for (const listener of listeners.current.get(folder) ?? []) listener();
    };
    // ACL endpoints are discovered URLs and may have opaque names. A file event
    // can change inherited access anywhere below its parent, so fan out there too.
    const affectedRoot = url.endsWith("/") ? url : parentOf(url);
    for (const folder of listeners.current.keys())
      if (affectedRoot && folder.startsWith(affectedRoot)) notify(folder);
    if (url.endsWith("/")) notify(parentOf(url));
    for (const [root, subscribers] of subtreeListeners.current) {
      if (
        url === root ||
        url.startsWith(root.endsWith("/") ? root : `${root}/`) ||
        (affectedRoot && root.startsWith(affectedRoot))
      ) {
        for (const listener of subscribers) listener();
      }
    }
  }, []);

  const client = useMemo(
    () =>
      createSolidDriveClient({
        storageUrl: session.storageUrl,
        fetch: session.fetch,
        confirmAccess,
        webId: session.webId,
        onProtectionChange: invalidate,
        onPrivateFolder: (url) =>
          toast(`${nameOf(url)} was restored as private`, {
            description:
              "Its original access was unknown. Only you can access this folder and new files in it.",
          }),
      }),
    [session, confirmAccess, invalidate],
  );

  useEffect(() => session.subscribe((url) => invalidate(url)), [session, invalidate]);

  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const unresolved = await client.recheckDeletions?.();
        if (!live) return;
        invalidate(session.storageUrl);
        if (unresolved?.length)
          toast.error("Still deleting on the server", {
            action: { label: "Retry", onClick: () => void check() },
          });
      } catch {
        if (live)
          toast.error("Couldn't check pending deletions", {
            action: { label: "Retry", onClick: () => void check() },
          });
      }
    };
    void check();
    return () => {
      live = false;
    };
  }, [client, invalidate, session.storageUrl]);

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

  const uploads = useUploadQueue(
    client,
    invalidate,
    JSON.stringify([session.storageUrl, session.webId]),
  );

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
      changes,
    }),
    [session, client, driveRoot, rootError, prefs, updatePrefs, uploads, invalidate, changes],
  );
  return (
    <DriveContext value={value}>
      {children}
      {dialog}
    </DriveContext>
  );
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
  const [snapshot, setSnapshot] = useState<{
    url: string | undefined;
    client: DriveClient;
    state: FolderState;
  }>({ url, client, state: { status: "loading" } });
  const generation = useRef(0);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!url) return;
    return changes.subscribe(url, reload);
  }, [url, changes, reload]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick forces a re-list
  useEffect(() => {
    if (!url) return;
    const request = ++generation.current;
    const controller = new AbortController();
    setSnapshot((current) => ({
      url,
      client,
      state:
        current.url === url && current.client === client && current.state.status === "ready"
          ? { ...current.state, refreshing: true }
          : { status: "loading" },
    }));
    client.list(url, { signal: controller.signal }).then(
      (items) => {
        if (!controller.signal.aborted && request === generation.current)
          setSnapshot({ url, client, state: { status: "ready", items, refreshing: false } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted && request === generation.current)
          setSnapshot({ url, client, state: { status: "error", error } });
      },
    );
    return () => controller.abort();
  }, [url, client, tick]);
  // Hide the preceding folder during the render before effect cleanup/setup runs.
  const state: FolderState =
    snapshot.url === url && snapshot.client === client && url
      ? snapshot.state
      : { status: "loading" };
  return { ...state, reload };
}
