// AUTHORED-BY Codex
// AUTHORED-BY Claude Opus 5.5
import { notFound } from "next/navigation";
import { decodeRef } from "@/lib/refs";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ ref: "__" }] : [];
}

export default async function DocumentPage({ params }: { params: Promise<{ ref: string }> }) {
  // The native export renders one placeholder page; DocsWorkspace reads the real ref from the
  // pathname on both targets, so only the web server can reject a malformed ref early.
  if (process.env.NEXT_PUBLIC_SUITE_TARGET !== "native") {
    const { ref } = await params;
    try {
      decodeRef(ref);
    } catch {
      notFound();
    }
  }
  return null;
}
