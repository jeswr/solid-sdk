// AUTHORED-BY Claude Opus 5.5
import { type ReactNode, Suspense } from "react";
import { PodSessionProvider } from "@/lib/session/pod-session";
import { DocumentSkeleton } from "./common";
import { DocsWorkspace } from "./docs-workspace";

/** The Docs route shell: the session, the workspace and the routed page under one boundary. */
export function DocsShell({ children }: { children: ReactNode }) {
  return (
    // The session lives inside the boundary so it only settles once the boundary has
    // hydrated: a session resolving above a boundary whose code is still loading makes it
    // hydrate the ready workspace against the server's loading markup (a mismatch).
    <Suspense fallback={<DocumentSkeleton />}>
      <PodSessionProvider>
        <DocsWorkspace />
        {children}
      </PodSessionProvider>
    </Suspense>
  );
}
