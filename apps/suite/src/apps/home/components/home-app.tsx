// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
/**
 * The frame for Home, Permissions and Connect services (03-home-permissions).
 * Like Drive, it runs against the session's injected `fetch` (the in-browser
 * demo pod until sign-in lands) inside the interim suite frame.
 */

import { Toaster } from "@jeswr/suite-ui";
import { createContext, type ReactNode, useContext } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { useDomainItems } from "../state/use-domain-items";
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
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out") {
    return (
      <div className="hm-boot">
        <h1>Home</h1>
        <p role="status">Sign in to open your pod</p>
      </div>
    );
  }
  return <HomeFrame session={state.session}>{children}</HomeFrame>;
}

function HomeFrame({ session, children }: { session: PodSession; children: ReactNode }) {
  const { counts } = useDomainItems(session);
  return (
    <HomeSessionContext value={session}>
      <SuiteFrame app="home" sidebar={<HomeSidebar counts={counts} />}>
        {children}
      </SuiteFrame>
    </HomeSessionContext>
  );
}

export function HomeApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
