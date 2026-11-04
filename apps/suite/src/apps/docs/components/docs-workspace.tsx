// AUTHORED-BY Codex
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Toaster, TooltipProvider } from "@jeswr/suite-ui";
import Link from "next/link";
import { decodeRef } from "@/lib/refs";
import { useRoutePathname } from "@/lib/route-params";
import { usePodSessionState } from "@/lib/session/pod-session";
import { DocsError, DocumentSkeleton } from "./common";
import { DocumentEditor } from "./document-editor";
import { DocumentList } from "./document-list";
export function DocsWorkspace() {
  const state = usePodSessionState();
  // The native export uses trailing-slash URLs.
  const pathname = useRoutePathname();
  if (state.status === "loading")
    return (
      <main id="main-content">
        <DocumentSkeleton />
      </main>
    );
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out")
    return (
      <main id="main-content">
        <p role="status">Sign in to open your Docs</p>
      </main>
    );
  if (state.status === "error")
    return (
      <main id="main-content">
        <DocsError title="We couldn't open your workspace">
          <Link href="/docs">Retry</Link>
        </DocsError>
      </main>
    );
  let resource: string | undefined;
  if (pathname.startsWith("/docs/d/")) {
    try {
      resource = decodeRef(pathname.slice("/docs/d/".length));
    } catch {
      return null;
    }
  }
  return (
    <TooltipProvider>
      <Toaster />
      {pathname === "/docs" ? (
        <DocumentList session={state.session} />
      ) : (
        <DocumentEditor session={state.session} resource={resource} />
      )}
    </TooltipProvider>
  );
}
