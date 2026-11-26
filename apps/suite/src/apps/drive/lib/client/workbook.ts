// AUTHORED-BY Codex GPT-6.1-Sol
import { createSheetStorage, workbookLayout } from "../../../sheets/lib/model";
import { assertWorkbook } from "../../../sheets/lib/workbook/layout";
import type { DriveItem } from "./client";

/** Match Sheets' metadata admission, and confirm its authoritative snapshot exists. */
export async function withWorkbook(
  item: DriveItem,
  storageUrl: string,
  fetch: typeof globalThis.fetch,
): Promise<DriveItem> {
  if (item.kind !== "folder") return item;
  try {
    const container = assertWorkbook(new URL("sheets/", storageUrl).href, item.url);
    const storage = createSheetStorage(fetch, storageUrl);
    const { value } = await storage.loadIndex(container);
    if (value.sheets.length === 0) return item;
    await storage.headEtag(workbookLayout(container).snapshot);
    return { ...item, workbook: true, name: value.title, modified: value.modified };
  } catch {
    // Ordinary, incomplete, forbidden and malformed folders remain browsable folders.
    return item;
  }
}
