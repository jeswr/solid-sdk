// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Toaster } from "@jeswr/suite-ui";
import type { ReactNode } from "react";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { WorkbookServiceProvider } from "../state/service";

function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="sht-state" role="status">
        Opening your spreadsheets…
      </div>
    );
  if (state.status === "error")
    return (
      <div className="sht-state" role="alert">
        <h1>Can't open your spreadsheets</h1>
        <p>This browser couldn't open your pod.</p>
      </div>
    );
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out")
    return (
      <div className="sht-state">
        <h1>Sheets</h1>
        <p role="status">Sign in to open your spreadsheets</p>
      </div>
    );
  return <WorkbookServiceProvider session={state.session}>{children}</WorkbookServiceProvider>;
}
export function SheetsApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
