// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { ErrorState, LoadingSkeleton, Toaster } from "@jeswr/suite-ui";
import type { ReactNode } from "react";
import { SuiteFrame } from "../../../components/interim-shell/suite-frame";
import { PodSessionProvider, usePodSessionState } from "../../../lib/session/pod-session";
import { AgentWorkspaceProvider } from "../lib/hooks";
import { ApprovalDeviceProvider } from "./approval-key-setup-sheet";
import { AgentSidebar } from "./sidebar";

function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading") return <LoadingSkeleton label="Opening your agent" />;
  if (state.status === "error")
    return <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />;
  return (
    <AgentWorkspaceProvider
      session={state.session}
      fallback={(query) =>
        query.status === "error" ? (
          <ErrorState error="unreachable" actions={{ retry: query.reload }} />
        ) : (
          <LoadingSkeleton label="Finding your agent" />
        )
      }
    >
      <ApprovalDeviceProvider>
        <SuiteFrame app="agent" sidebar={<AgentSidebar />} context="Agent">
          {children}
        </SuiteFrame>
      </ApprovalDeviceProvider>
    </AgentWorkspaceProvider>
  );
}
export function AgentApp({ children }: { children: ReactNode }) {
  return (
    <div className="agent-app">
      <PodSessionProvider>
        <SessionGate>{children}</SessionGate>
      </PodSessionProvider>
      <Toaster />
    </div>
  );
}
