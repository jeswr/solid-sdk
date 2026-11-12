// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { JournalPrivacyError, type JournalStore } from "@jeswr/solid-journal";
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
import { ensureSample } from "../demo/sample";
import { openJournalData } from "../lib/data/store";
import { JournalController } from "./journal-controller";

interface JournalContextValue {
  controller: JournalController;
  store: JournalStore;
}
const Context = createContext<JournalContextValue | null>(null);
export function JournalProvider({
  session,
  children,
  fallback,
}: {
  session: PodSession;
  children: ReactNode;
  fallback: (
    error: boolean,
    retry: () => void,
    makePrivate?: () => void,
    message?: string,
  ) => ReactNode;
}) {
  const [value, setValue] = useState<JournalContextValue | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [repair, setRepair] = useState<JournalStore | null>(null);
  const [privacyMessage, setPrivacyMessage] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries setup
  useEffect(() => {
    let live = true;
    setValue(null);
    setError(false);
    setRepair(null);
    setPrivacyMessage(undefined);
    let stop: (() => void) | undefined;
    let opening: JournalStore | undefined;
    void (async () => {
      const store = await openJournalData(session);
      opening = store;
      await store.initialize();
      await ensureSample(session, store);
      if (!live) return;
      const controller = new JournalController(store, () =>
        toast.error("Couldn't save your journal. Your words are kept here for retry."),
      );
      setValue({ controller, store });
      await controller.load();
      if (!live) return;
      stop = session.subscribe((url) => {
        if (url.startsWith(store.container) && !controller.getSnapshot().saving)
          void controller.load();
      });
    })().catch((cause) => {
      if (live) {
        setError(true);
        if (cause instanceof JournalPrivacyError) setPrivacyMessage(cause.message);
        if (cause instanceof JournalPrivacyError && cause.canMakePrivate && opening)
          setRepair(opening);
      }
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [session, attempt]);
  return value ? (
    <Context value={value}>{children}</Context>
  ) : (
    fallback(
      error,
      () => setAttempt((n) => n + 1),
      repair
        ? () => {
            setError(false);
            void repair.makePrivate().then(
              () => setAttempt((n) => n + 1),
              (cause) => {
                setError(true);
                if (cause instanceof JournalPrivacyError) setPrivacyMessage(cause.message);
                toast.error("Couldn't make your journal private. Reconnect and try again.");
              },
            );
          }
        : undefined,
      privacyMessage,
    )
  );
}
export function useJournal() {
  const context = useContext(Context);
  if (!context) throw new Error("Journal provider is required");
  const state = useSyncExternalStore(
    context.controller.subscribe,
    context.controller.getSnapshot,
    context.controller.getSnapshot,
  );
  return { ...context, ...state };
}
