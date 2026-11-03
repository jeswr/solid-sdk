// AUTHORED-BY Codex GPT-6
"use client";
import type { ReactNode } from "react";
import type { SessionState } from "./types";

export type { DemoPodSession, ExtensionPodSession, PodSession } from "./types";

// Explicit native adaptation until the mobile authentication work supplies a real session.
export function PodSessionProvider({ children }: { children: ReactNode }) {
  return children;
}
export function usePodSessionState(): SessionState {
  return {
    status: "signed-out",
    extension: { present: false, granted: false, webId: null },
    connectExtension: async () => {},
  };
}
