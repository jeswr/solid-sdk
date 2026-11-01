// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Toaster } from "@jeswr/suite-ui";
import { type ReactNode, Suspense } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { MailProvider, useMail } from "../state/mail-context";
import { MailSidebar } from "./sidebar";

function MailChrome({ children }: { children: ReactNode }) {
  const { patches } = useMail();
  const saving = patches.some((patch) => patch.confirmedAt === undefined);
  return (
    <SuiteFrame
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
    </SuiteFrame>
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
  if (state.status === "error")
    return (
      <div className="mail-boot" role="alert">
        <h1>Can't open your Mail</h1>
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
  );
}
