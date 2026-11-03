// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { decodeRef } from "@/lib/refs";
import { usePageRouteParams } from "@/lib/route-params";
import { NewSpreadsheet } from "./new-spreadsheet";
import { SheetEditor, SheetNotFound } from "./sheet-editor";

/** The spreadsheet's container, or undefined when the ref does not name one. */
export function sheetContainer(ref: string): string | undefined {
  try {
    const container = decodeRef(ref);
    const url = new URL(container);
    if (!url.pathname.endsWith("/") || url.search || url.hash || url.username || url.password)
      return undefined;
    return container;
  } catch {
    return undefined;
  }
}

/** Reads the sheet ref on the client, so the native export's placeholder page works too. */
export function SheetRoute() {
  const params = usePageRouteParams<{ ref: string }>("/sheets/s/[ref]");
  if (!params) return <LoadingSkeleton preset="grid" />;
  const container = sheetContainer(params.ref);
  if (!container) return <SheetNotFound />;
  return <SheetEditor key={container} container={container} />;
}

/** The import source comes from the URL on the client, so the page can be exported statically. */
export function NewSheetRoute() {
  const src = useSearchParams().get("src");
  return <NewSpreadsheet {...(src ? { src } : {})} />;
}
