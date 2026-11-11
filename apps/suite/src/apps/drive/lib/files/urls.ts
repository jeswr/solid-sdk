// AUTHORED-BY Codex GPT-6.1-Sol
import { encodeRef } from "@/lib/refs";
import type { DriveItem } from "../client/client";
import { sheetsHref } from "../open-with/sheets";

/** The Drive URL that opens `item`: folders navigate, files preview. */
export function hrefFor(item: Pick<DriveItem, "url" | "kind" | "workbook">): string {
  if (item.workbook) return sheetsHref(item.url);
  return item.kind === "folder"
    ? `/drive/f/${encodeRef(item.url)}`
    : `/drive/p/${encodeRef(item.url)}`;
}
