// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import type { ReactNode } from "react";
import { AppFrame } from "@/shell/app-frame";
import { AppSession } from "@/shell/app-session";
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
export function MailApp({ children }: { children: ReactNode }) {
  return (
    <AppSession name="Mail" className="mail-boot" retry suspense>
      {(session) => (
        <MailProvider session={session}>
          <MailChrome>{children}</MailChrome>
        </MailProvider>
      )}
    </AppSession>
  );
}
