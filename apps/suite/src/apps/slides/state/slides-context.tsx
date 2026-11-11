// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { DeckRepository } from "@jeswr/solid-slides";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { seedSlides } from "../demo/sample";
import { connectSlides } from "../lib/data/connect";
import { SlidesStore } from "./slides-store";
export const SlidesContext = createContext<{
  store: SlidesStore;
  repository: DeckRepository;
  session: PodSession;
} | null>(null);
export function useSlides() {
  const value = useContext(SlidesContext);
  if (!value) throw new Error("Slides needs its provider");
  const snapshot = useSyncExternalStore(
    value.store.subscribe,
    value.store.getSnapshot,
    value.store.getSnapshot,
  );
  return { ...value, ...snapshot };
}
export function SlidesProvider({
  session,
  children,
  fallback,
}: {
  session: PodSession;
  children: ReactNode;
  fallback: (error: boolean, retry: () => void) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<{
    store: SlidesStore;
    repository: DeckRepository;
    session: PodSession;
  } | null>(null);
  const [error, setError] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the explicit retry signal.
  useEffect(() => {
    let active = true;
    let store: SlidesStore | undefined;
    const key = `solid-slides:drafts:${session.mode}:${session.webId}:${session.storageUrl}`;
    setError(false);
    void (async () => {
      const repository = await connectSlides(session);
      await repository.initialise();
      await seedSlides(session, repository);
      const decks = await repository.list();
      if (!active) return;
      store = new SlidesStore(
        repository,
        decks,
        (message) => toast.error(message),
        (draft) => localStorage.setItem(key, draft),
      );
      try {
        const saved = localStorage.getItem(key);
        if (saved) store.restore(saved);
      } catch {
        /* Pod access remains usable without browser storage. */
      }
      setConnection({ store, repository, session });
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      store?.dispose();
    };
  }, [session, attempt]);
  useEffect(() => {
    if (!connection) return;
    const flush = () => {
      void connection.store.flush(true);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const retry = () => {
      void connection.store.flush();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (connection.store.getSnapshot().pending) {
        flush();
        event.preventDefault();
      }
    };
    addEventListener("pagehide", flush);
    addEventListener("beforeunload", unload);
    addEventListener("online", retry);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      removeEventListener("pagehide", flush);
      removeEventListener("beforeunload", unload);
      removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [connection]);
  return connection ? (
    <SlidesContext value={connection}>{children}</SlidesContext>
  ) : (
    fallback(error, () => setAttempt((value) => value + 1))
  );
}
