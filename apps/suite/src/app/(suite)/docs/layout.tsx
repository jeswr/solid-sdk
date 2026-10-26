// AUTHORED-BY Codex
import { type ReactNode, Suspense } from "react";
import { DocumentSkeleton } from "@/apps/docs/components/common";
import { DocsWorkspace } from "@/apps/docs/components/docs-workspace";
import { PodSessionProvider } from "@/lib/session/pod-session";
import "@/apps/docs/components/docs.css";
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <Suspense fallback={<DocumentSkeleton />}>
        <DocsWorkspace />
        {children}
      </Suspense>
    </PodSessionProvider>
  );
}
