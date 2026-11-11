// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, Toaster } from "@jeswr/suite-ui";
import { type ReactNode, Suspense } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { MailProvider, useMail } from "../state/mail-context";
import { MailSidebar } from "./sidebar";

function MailChrome({ children }: { children: ReactNode }) {
  const { patches } = useMail();
  const saving = patches.some((patch) => patch.confirmedAt === undefined);
  return (
    <AppFrame
      app="mail"
      sidebar={<MailSidebar />}
      search={{ placeholder: "Search mail", action: "/mail/search", scopeLabel: "in Mail" }}
      actions={
        <span className="mail-muted" role="status" aria-label="Mail save status" aria-live="polite">
          {saving ? "Saving…" : ""}
        </span>
      }
    >
      {children}
    </AppFrame>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="mail-boot" role="status">
        Opening your Mail…
      </div>
    );
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out")
    return (
      <div className="mail-boot" role="status">
        <AppHeading>Sign in to open your Mail</AppHeading>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="mail-boot" role="alert">
        <AppHeading>Can't open your Mail</AppHeading>
        <p>
          {state.mode === "extension"
            ? "This browser couldn't open your pod through the Solid extension."
            : "This browser couldn't open the demo pod's storage."}
        </p>
        <Button onClick={() => location.reload()}>Retry</Button>
      </div>
    );
  return (
    <MailProvider
      key={JSON.stringify([state.session.mode, state.session.webId, state.session.storageUrl])}
      session={state.session}
    >
      <MailChrome>{children}</MailChrome>
    </MailProvider>
  );
}
export function MailApp({ children }: { children: ReactNode }) {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <Suspense
          fallback={
            <div className="mail-boot" role="status">
              Opening your Mail…
            </div>
          }
        >
          <SessionGate>{children}</SessionGate>
        </Suspense>
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
