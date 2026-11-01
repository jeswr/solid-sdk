// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The account the suite is acting for. Until sign-in (SH-02) and the SDK façade
 * (SDK-APP-01) land, the only account is the in-browser demo pod, so every app
 * runs its real data layer against an injected `fetch`. Swapping in a signed-in
 * session means providing the same shape with the session's fetch.
 */

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { getDemoPod, resetDemoPod } from "../demo-pod/browser";
import { DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../demo-pod/seed";

export interface PodSession {
  readonly mode: "demo";
  readonly webId: string;
  readonly displayName: string;
  readonly storageUrl: string;
  readonly fetch: typeof globalThis.fetch;
  /** Change events for resources in the storage (the demo pod's live updates). */
  subscribe(listener: (url: string) => void): () => void;
  reset(): Promise<void>;
}

type SessionState =
  | { status: "loading" }
  | { status: "ready"; session: PodSession }
  | { status: "error"; error: unknown };

const SessionContext = createContext<SessionState>({ status: "loading" });

export function PodSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    getDemoPod().then(
      (pod) =>
        live &&
        setState({
          status: "ready",
          session: {
            mode: "demo",
            webId: DEMO_WEBID,
            displayName: DEMO_NAME,
            storageUrl: DEMO_ROOT,
            fetch: pod.fetch,
            subscribe: pod.subscribe,
            reset: async () => {
              await resetDemoPod();
              location.reload();
            },
          },
        }),
      (error: unknown) => live && setState({ status: "error", error }),
    );
    return () => {
      live = false;
    };
  }, []);
  return <SessionContext value={state}>{children}</SessionContext>;
}

export function usePodSessionState(): SessionState {
  return useContext(SessionContext);
}
