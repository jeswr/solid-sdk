// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { createSheetStorage, SheetStorageError, workbookLayout } from "../../../sheets/lib/model";
import { assertWorkbook } from "../../../sheets/lib/workbook/layout";
import type { DriveItem } from "./client";

/** Rename and move are unsafe for a workbook, and for a Sheets child that might be one. */
export function isWorkbookLike(item: Pick<DriveItem, "workbook" | "workbookUnknown">): boolean {
  return item.workbook === true || item.workbookUnknown === true;
}

const absent = (error: unknown) =>
  error instanceof SheetStorageError && (error.status === 404 || error.status === 410);

/** Match Sheets' metadata admission, and confirm its authoritative snapshot exists. */
export async function withWorkbook(
  item: DriveItem,
  storageUrl: string,
  fetch: typeof globalThis.fetch,
): Promise<DriveItem> {
  if (item.kind !== "folder") return item;
  let container: string;
  try {
    container = assertWorkbook(new URL("sheets/", storageUrl).href, item.url);
  } catch {
    // Not a direct child of Sheets: an ordinary folder, and nothing is fetched.
    return item;
  }
  try {
    const storage = createSheetStorage(fetch, storageUrl);
    const { value } = await storage.loadIndex(container);
    if (value.sheets.length === 0) return item;
    await storage.headEtag(workbookLayout(container).snapshot);
    return { ...item, workbook: true, name: value.title, modified: value.modified };
  } catch (error) {
    // A missing index or snapshot settles it: an ordinary or incomplete folder. A forbidden,
    // failed or malformed read doesn't, so keep it browsable but fail closed on rename/move.
    return absent(error) ? item : { ...item, workbookUnknown: true };
  }
}
