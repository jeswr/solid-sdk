// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound } from "next/navigation";
import { decodeRef } from "@/lib/refs";
import { usePageRouteParams } from "@/lib/route-params";
import { LedgerScreen } from "./ledger";

/** Reads the account ref on the client so the native export's placeholder page works too. */
export function LedgerRoute() {
  const params = usePageRouteParams<{ ref: string }>("/money/a/[ref]");
  // Only the native placeholder page has no params; any other miss is a 404.
  if (!params) return <LoadingSkeleton preset="list" label="Loading account" />;
  let id: string;
  try {
    id = decodeRef(params.ref);
  } catch {
    notFound();
  }
  return <LedgerScreen accountId={id} />;
}
