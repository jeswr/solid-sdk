// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LedgerRoute } from "@/apps/money/components/ledger-route";
import { MoneyOpening } from "@/apps/money/components/money-states";
import { decodeRef } from "@/lib/refs";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ ref: "__" }] : [];
}

export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  // The native export renders one placeholder page and LedgerRoute reads the real ref from the
  // pathname, so only the web server can answer a malformed ref with a 404.
  if (process.env.NEXT_PUBLIC_SUITE_TARGET !== "native") {
    const { ref } = await params;
    try {
      decodeRef(ref);
    } catch {
      notFound();
    }
  }
  return (
    <Suspense fallback={<MoneyOpening />}>
      <LedgerRoute />
    </Suspense>
  );
}
