// AUTHORED-BY Codex GPT-6
"use client";
import type { ReactNode } from "react";
import { useOptionalAccounts } from "@/shell/session/accounts-context";
import { ABSENT } from "./extension-session";
import { SessionContext, ShellPodSessionProvider } from "./shell-pod-session";
import type { SessionState } from "./types";

export { usePodSessionState } from "./shell-pod-session";
export type { DemoPodSession, ExtensionPodSession, PodSession } from "./types";

const signedOut: SessionState = {
  status: "signed-out",
  extension: ABSENT,
  connectExtension: async () => {},
};

export function PodSessionProvider({ children }: { children: ReactNode }) {
  const accounts = useOptionalAccounts();
  return accounts ? (
    <ShellPodSessionProvider accounts={accounts}>{children}</ShellPodSessionProvider>
  ) : (
    <SessionContext value={signedOut}>{children}</SessionContext>
  );
}
