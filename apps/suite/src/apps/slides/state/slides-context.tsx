// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
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
import { SlideSessionContext } from "../components/slide-canvas";
import { seedSlides } from "../demo/sample";
import { connectSlides } from "../lib/data/connect";
import { createDraftStorage, type DraftStorage } from "./draft-storage";
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
    let drafts: DraftStorage | undefined;
    const key = `solid-slides:drafts:${session.mode}:${session.webId}:${session.storageUrl}`;
    setError(false);
    void (async () => {
      const repository = await connectSlides(session);
      await repository.initialise();
      await seedSlides(session, repository);
      const listing = await repository.list();
      const local = createDraftStorage(key);
      // Pod access remains usable without browser storage.
      const saved = await local.load().catch((): string[] => []);
      if (!active) {
        local.dispose();
        return;
      }
      drafts = local;
      store = new SlidesStore(
        repository,
        listing.decks,
        (message) => toast.error(message),
        (value) => local.save(value),
        listing.broken,
      );
      for (const value of saved) store.restore(value);
      setConnection({ store, repository, session });
    })().catch(() => {
      if (active) setError(true);
    });
    return () => {
      active = false;
      store?.dispose();
      drafts?.dispose();
    };
  }, [session, attempt]);
  useEffect(() => {
    if (!connection) return;
    // Leaving the page may cancel ordinary requests, so teardown sends its own keepalive save.
    const flush = () => {
      void connection.store.flush(true, true);
    };
    // A hidden tab stays alive: its keepalive save queues behind any save in flight.
    const hidden = () => {
      if (document.visibilityState === "hidden") void connection.store.flush(true, false);
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
    <SlidesContext value={connection}>
      <SlideSessionContext value={session}>{children}</SlideSessionContext>
    </SlidesContext>
  ) : (
    fallback(error, () => setAttempt((value) => value + 1))
  );
}
