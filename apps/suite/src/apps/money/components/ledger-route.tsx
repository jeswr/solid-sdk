// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound } from "next/navigation";
import { decodeRef } from "@/lib/refs";
import { useRouteParams } from "@/lib/route-params";
import { LedgerScreen } from "./ledger";

/** Reads the account ref on the client so the native export's placeholder page works too. */
export function LedgerRoute() {
  const params = useRouteParams<{ ref: string }>("/money/a/[ref]");
  // Only the literal placeholder path (`/money/a/__/`) has no params; show the loading state.
  if (!params) return <LoadingSkeleton preset="list" />;
  let id: string;
  try {
    id = decodeRef(params.ref);
  } catch {
    notFound();
  }
  return <LedgerScreen accountId={id} />;
}
