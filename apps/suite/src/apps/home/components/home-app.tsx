// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * The frame for Home, Permissions and Connect services (03-home-permissions).
 * Like Drive, it runs against the session's injected `fetch` (the in-browser
 * demo pod until sign-in lands) inside the interim suite frame.
 */

import { createContext, type ReactNode, useContext } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { HomeSidebar } from "./home-sidebar";

const HomeSessionContext = createContext<PodSession | undefined>(undefined);

/** The signed-in session inside the Home frame; throws outside it. */
export function useHomeSession(): PodSession {
  const session = useContext(HomeSessionContext);
  if (!session) throw new Error("useHomeSession must be used inside <HomeApp>");
  return session;
}

function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading") {
    return (
      <div className="hm-boot" role="status">
        Opening your pod…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="hm-boot" role="alert">
        <h1>Can't open your pod</h1>
        <p>This browser couldn't open the demo pod's storage.</p>
      </div>
    );
  }
  return (
    <HomeSessionContext value={state.session}>
      <SuiteFrame app="home" sidebar={<HomeSidebar />}>
        {children}
      </SuiteFrame>
    </HomeSessionContext>
  );
}

export function HomeApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      {/* Toasts go to the shell's toast region, which every page outside Drive mounts. */}
      <SessionGate>{children}</SessionGate>
    </PodSessionProvider>
  );
}
