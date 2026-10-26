// AUTHORED-BY Codex
"use client";
import { Toaster } from "@jeswr/suite-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { decodeRef } from "@/lib/refs";
import { usePodSessionState } from "@/lib/session/pod-session";
import { DocsError, DocumentSkeleton } from "./common";
import { DocumentEditor } from "./document-editor";
import { DocumentList } from "./document-list";
export function DocsWorkspace() {
  const state = usePodSessionState();
  const pathname = usePathname();
  if (state.status === "loading")
    return (
      <main id="main-content">
        <DocumentSkeleton />
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
    <>
      <Toaster />
      {pathname === "/docs" ? (
        <DocumentList session={state.session} />
      ) : (
        <DocumentEditor session={state.session} resource={resource} />
      )}
    </>
  );
}
