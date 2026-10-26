// AUTHORED-BY Codex
import { type ReactNode, Suspense } from "react";
import { DocumentSkeleton } from "@/apps/docs/components/common";
import { DocsWorkspace } from "@/apps/docs/components/docs-workspace";
import { PodSessionProvider } from "@/lib/session/pod-session";
import "@/apps/docs/components/docs.css";
export default function DocsLayout({ children }: { children: ReactNode }) {
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
