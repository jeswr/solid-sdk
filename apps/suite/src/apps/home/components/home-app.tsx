// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";

/**
 * The frame for Home, Permissions and Connect services (03-home-permissions).
 * Like Drive, it uses the shell account's injected fetch and shared frame;
 * standalone previews retain the interim frame and session adapter.
 */

import { Toaster } from "@jeswr/suite-ui";
import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
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
        <AppHeading>Can't open your pod</AppHeading>
        <p>This browser couldn't open the demo pod's storage.</p>
      </div>
    );
  }
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out") {
    return (
      <div className="hm-boot">
        <AppHeading>Home</AppHeading>
        <p role="status">Sign in to open your pod</p>
      </div>
    );
  }
  return <HomeFrame session={state.session}>{children}</HomeFrame>;
}

function HomeFrame({ session, children }: { session: PodSession; children: ReactNode }) {
  const { counts } = useDomainItems(session);
  const pathname = usePathname();
  return (
    <HomeSessionContext value={session}>
      <AppFrame
        app="home"
        pageTitle={pathname === "/shared" ? "Shared with me" : undefined}
        sidebar={<HomeSidebar counts={counts} />}
      >
        {children}
      </AppFrame>
    </HomeSessionContext>
  );
}

export function HomeApp({ children }: { children: ReactNode }) {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate>{children}</SessionGate>
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
