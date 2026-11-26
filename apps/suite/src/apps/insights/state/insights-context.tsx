// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { useConnectionState } from "@/shell/sync/connection-state";
import { createInsightsStore } from "./store";

const Context = createContext<{
  store: ReturnType<typeof createInsightsStore>;
  session: PodSession;
  timeZone: string;
} | null>(null);
export function InsightsProvider({
  session,
  children,
}: {
  session: PodSession;
  children: ReactNode;
}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const store = useMemo(() => createInsightsStore(session, timeZone), [session, timeZone]);
  const connection = useConnectionState();
  useEffect(() => {
    if (connection === "online" || store.getSnapshot().status === "loading") void store.refresh();
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = session.subscribe(() => {
      if (connection !== "online") return;
      clearTimeout(timer);
      timer = setTimeout(() => void store.refresh(), 500);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      store.cancel();
    };
  }, [session, store, connection]);
  return <Context value={{ store, session, timeZone }}>{children}</Context>;
}
export function useInsights() {
  const context = useContext(Context);
  if (!context) throw new Error("InsightsProvider is required");
  const snapshot = useSyncExternalStore(
    context.store.subscribe,
    context.store.getSnapshot,
    context.store.getSnapshot,
  );
  return { ...context, ...snapshot, refresh: () => void context.store.refresh() };
}
