// AUTHORED-BY Claude Opus 5.5
"use client";
import { notFound } from "next/navigation";
import { decodeRef } from "@/lib/refs";
import { useRouteParams } from "@/lib/route-params";
import { LedgerScreen } from "./ledger";

/** Reads the account ref on the client so the native export's placeholder page works too. */
export function LedgerRoute() {
  const params = useRouteParams<{ ref: string }>("/money/a/[ref]");
  if (!params) return null;
  let id: string;
  try {
    id = decodeRef(params.ref);
  } catch {
    notFound();
  }
  return <LedgerScreen accountId={id} />;
}
