// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { createBookmarkRepository } from "@jeswr/solid-bookmark/pod";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
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
        });
        await ensureSample(session, repository);
        if (!live) return;
        opened = createLibraryStore(repository, () =>
          toast.error(
            "Couldn't save your bookmark. The failed change was rolled back. Refresh before trying again.",
          ),
        );
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
