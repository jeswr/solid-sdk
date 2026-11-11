// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { TripsStore } from "@jeswr/solid-trips";
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
import { openTrips } from "../lib/data/open";
import { createTripsState, type TripsState } from "./trips-state";

type Ready = { state: TripsState; store: TripsStore; session: PodSession };
const Context = createContext<Ready | null>(null);
export function TripsProvider({
  session,
  children,
  fallback,
}: {
  session: PodSession;
  children: ReactNode;
  fallback: (error: boolean, retry: () => void) => ReactNode;
}) {
  const [ready, setReady] = useState<Ready>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries opening this session.
  useEffect(() => {
    let active = true;
    let state: TripsState | undefined;
    setReady(undefined);
    setFailed(false);
    void openTrips(session).then(
      ({ store, snapshot }) => {
        if (!active) return;
        state = createTripsState(store, snapshot, (message) => toast.error(message));
        setReady({ state, store, session });
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
      state?.dispose();
    };
  }, [session, attempt]);
  return ready?.session === session ? (
    <Context value={ready}>{children}</Context>
  ) : (
    fallback(failed, () => setAttempt((n) => n + 1))
  );
}
export function useTrips() {
  const context = useContext(Context);
  if (!context) throw new Error("Trips provider is required");
  const snapshot = useSyncExternalStore(
    context.state.subscribe,
    context.state.getSnapshot,
    context.state.getSnapshot,
  );
  return { ...context, ...snapshot };
}
