// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { EmptyState, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import type { ReactNode } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/offline-provider";
import { FormsProvider } from "../state/forms-context";

function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  const connection = useConnectionState();
  if (state.status === "loading") return <LoadingSkeleton label="Opening your pod…" />;
  if (state.status === "error") return <ErrorState error="unknown" />;
  if (state.status === "signed-out")
    return (
      <EmptyState title="Sign in to open Forms" body="Your forms and answers stay in your pod." />
    );
  return (
    <AppFrame
      app="forms"
      sidebar={
        <div className="fm-sidebar">
          <strong>Forms</strong>
          <p>
            Thoughtful questions.
            <br />
            Answers you own.
          </p>
          <a href="/forms">All forms</a>
        </div>
      }
    >
      <div className="fm-page">
        {connection !== "online" && (
          <p role="status" className="fm-notice">
            You're offline. Keep this page open to preserve your draft; saving needs a connection.
          </p>
        )}
        {state.session.mode === "demo" && (
          <p className="fm-notice">
            Demo · Fictional forms and responses. This preview uses a JSON simulation in your demo
            pod.
          </p>
        )}
        <FormsProvider
          key={`${state.session.mode}:${state.session.webId}:${state.session.storageUrl}`}
          session={state.session}
          unavailable={
            <EmptyState
              title="Forms is getting ready for your pod"
              body="The SHACL runtime connection is still being built. Explore Forms with a demo account for now."
            />
          }
        >
          {children}
        </FormsProvider>
      </div>
    </AppFrame>
  );
}
export function FormsApp({ children }: { children: ReactNode }) {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate>{children}</SessionGate>
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
