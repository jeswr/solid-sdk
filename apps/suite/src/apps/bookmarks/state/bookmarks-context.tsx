// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
"use client";
import { verifyPrivateDemoAccess } from "@jeswr/pod-access/roles";
import { BookmarkPrivacyError, createBookmarkRepository } from "@jeswr/solid-bookmark/pod";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { ErrorState, toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ensureSample } from "../demo/sample";
import { createLibraryStore, type LibraryStore } from "./library-store";

const Context = createContext<LibraryStore | null>(null);
const DISCOVERY_TIMEOUT_MS = 30_000;
function saveFailureMessage(error: unknown): string {
  if (error instanceof BookmarkPrivacyError) return error.message;
  if (error instanceof StorageError) {
    switch (error.code) {
      case "unauthenticated":
        return "Your pod requires you to sign in again before saving bookmarks.";
      case "forbidden":
        return "Your pod denied the change. Check your permissions before retrying.";
      case "rate-limited":
        return "Your pod is receiving too many requests. Wait before retrying.";
    }
  }
  return "Couldn't save your bookmark. The failed change was rolled back. Refresh before trying again.";
}
export function BookmarksProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const [store, setStore] = useState<LibraryStore | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries storage discovery.
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    let opened: LibraryStore | undefined;
    let off: (() => void) | undefined;
    // Cleanup clears this timer, so it only fires while the effect is live.
    const timeout = setTimeout(() => {
      controller.abort();
      setError(true);
    }, DISCOVERY_TIMEOUT_MS);
    setStore(null);
    setError(false);
    void Promise.resolve()
      .then(async () => {
        controller.signal.throwIfAborted();
        const { storage } = await createPodClient({
          fetch: session.fetch,
          storage: session.storageUrl,
          capabilities: createMemoryCache(),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!live || controller.signal.aborted) return;
        const repository = createBookmarkRepository({
          storage,
          fetch: session.fetch,
          profile: session.webId,
          collectionStorage: {
            getItem: (key) => window.localStorage.getItem(key),
            setItem: (key, value) => window.localStorage.setItem(key, value),
          },
          ...(session.mode === "demo"
            ? {
                verifyOwnerOnly: (url: string) =>
                  verifyPrivateDemoAccess(session, url, session.webId),
              }
            : {}),
        });
        await ensureSample(session, repository);
        if (!live) return;
        opened = createLibraryStore(repository, (error) => toast.error(saveFailureMessage(error)));
        setStore(opened);
        void opened.load();
        off = session.subscribe(() => {
          if (!opened?.getSnapshot().saving) void opened?.load();
        });
      })
      .catch(() => {
        clearTimeout(timeout);
        if (live) setError(true);
      });
    return () => {
      live = false;
      clearTimeout(timeout);
      controller.abort();
      off?.();
      opened?.dispose();
    };
  }, [session, attempt]);
  if (error)
    return (
      <div className="bkm-page">
        <ErrorState error="unreachable" actions={{ retry: () => setAttempt((value) => value + 1) }}>
          <p>Couldn't open your bookmark storage.</p>
        </ErrorState>
      </div>
    );
  return <Context value={store}>{children}</Context>;
}
export function useBookmarks() {
  return useContext(Context);
}
const initial = {
  items: [],
  skipped: [],
  registration: "pending" as const,
  status: "loading" as const,
  error: null,
  saving: 0,
  importRemaining: 0,
};
const noSubscribe = () => () => {};
export function useBookmarkSnapshot() {
  const store = useBookmarks();
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getSnapshot ?? (() => initial),
    () => initial,
  );
}
