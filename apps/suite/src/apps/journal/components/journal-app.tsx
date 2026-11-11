// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import { BookOpen, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppSessionGuard } from "@/shell/app-frame";
import { JournalProvider } from "../state/journal-context";
import { PrivacyRepair } from "./privacy-repair";

function Boot({
  error,
  retry,
  makePrivate,
  message,
}: {
  error: boolean;
  retry?: () => void;
  makePrivate?: () => void;
  message?: string;
}) {
  return (
    <div className="jn-page">
      {error ? (
        <ErrorState error="unreachable" actions={retry ? { retry } : {}}>
          <p>
            We couldn't open your private journal. Check your connection and that Journal storage is
            private.
          </p>
          {message && <p>{message}</p>}
          {makePrivate && <PrivacyRepair makePrivate={makePrivate} />}
        </ErrorState>
      ) : (
        <LoadingSkeleton preset="list" label="Opening your journal" />
      )}
    </div>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading") return <Boot error={false} />;
  if (state.status === "error") return <Boot error />;
  if (state.status === "signed-out")
    return (
      <div className="jn-page">
        <p>Sign in to open your journal.</p>
      </div>
    );
  return (
    <JournalProvider
      key={`${state.session.webId}:${state.session.storageUrl}`}
      session={state.session}
      fallback={(error, retry, makePrivate, message) => (
        <Boot
          error={error}
          retry={retry}
          {...(makePrivate ? { makePrivate } : {})}
          {...(message ? { message } : {})}
        />
      )}
    >
      <AppFrame
        app="journal"
        sidebar={
          <div className="jn-sidebar">
            <BookOpen size={28} aria-hidden="true" />
            <strong>Journal</strong>
            <p>A little space for your everyday.</p>
            <p className="jn-private">
              <LockKeyhole size={16} aria-hidden="true" />
              Only you can see this
            </p>
            <Button variant="ghost" asChild>
              <a href="/journal">Your journal</a>
            </Button>
          </div>
        }
      >
        {children}
      </AppFrame>
    </JournalProvider>
  );
}
export function JournalApp({ children }: { children: ReactNode }) {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate>{children}</SessionGate>
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
