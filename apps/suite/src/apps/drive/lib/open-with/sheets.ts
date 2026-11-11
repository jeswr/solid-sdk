// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { encodeRef } from "@/lib/refs";
import { MAX_IMPORT_BYTES } from "../../../docs/lib/convert/import-file";
import type { WorkbookService } from "../../../sheets/lib/contract";
import type { DriveItem } from "../client/client";
import { isOwnStorage } from "../client/ownership";
import { canWriteFromWacAllow } from "./docs";

export const SHEETS_READ_ONLY_REASON = "You can't create spreadsheets in your Sheets folder";
export const SHEETS_TOO_LARGE_REASON = "Sheets can open files of 50 MB or less";
export const SHEETS_FOREIGN_REASON = "Only files in your pod can be opened with Sheets";

export function sheetsHref(container: string): string {
  return `/sheets/${encodeRef(container)}`;
}

export interface SheetsSession {
  readonly storageUrl: string;
  readonly webId: string;
  readonly fetch: typeof globalThis.fetch;
}

export type OpenWithSheetsState =
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "convert"; readonly disabledReason?: string };

export function openWithSheetsState(
  item: DriveItem,
  context: {
    storageUrl: string;
    offlineReason?: string | undefined;
    sheetsWritable?: boolean | undefined;
  },
): OpenWithSheetsState | undefined {
  if (item.workbook) return { kind: "open", href: sheetsHref(item.url) };
  if (
    item.kind !== "file" ||
    (!/\.csv$/i.test(item.name) &&
      item.contentType?.split(";")[0]?.trim().toLowerCase() !== "text/csv")
  )
    return undefined;
  if (!isOwnStorage(item.url, context.storageUrl))
    return { kind: "convert", disabledReason: SHEETS_FOREIGN_REASON };
  if ((item.size ?? 0) > MAX_IMPORT_BYTES)
    return { kind: "convert", disabledReason: SHEETS_TOO_LARGE_REASON };
  if (context.offlineReason) return { kind: "convert", disabledReason: context.offlineReason };
  if (context.sheetsWritable === false)
    return { kind: "convert", disabledReason: SHEETS_READ_ONLY_REASON };
  return { kind: "convert" };
}

/** Unknown permissions allow an attempt; only a confirmed refusal disables importing. */
export async function probeSheetsWritable(session: SheetsSession): Promise<boolean | undefined> {
  const http = createPodScopedFetch(session.storageUrl, { fetch: refuseRedirects(session.fetch) });
  const head = (url: string) =>
    http(url, { method: "HEAD", headers: { "cache-control": "no-cache" } });
  try {
    let response = await head(new URL("sheets/", session.storageUrl).href);
    if (response.status === 404) response = await head(session.storageUrl);
    if (response.status === 401 || response.status === 403) return false;
    return response.ok ? canWriteFromWacAllow(response.headers.get("wac-allow")) : undefined;
  } catch {
    return undefined;
  }
}

/** Bound the download even when metadata or Content-Length is absent or incorrect. */
async function readCsv(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_IMPORT_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error(SHEETS_TOO_LARGE_REASON);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_IMPORT_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error(SHEETS_TOO_LARGE_REASON);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** The same service importer used by Sheets; the source is only ever read. */
export async function openWithSheets(
  item: DriveItem,
  session: SheetsSession,
  service: Pick<WorkbookService, "createFromCsv">,
) {
  const state = openWithSheetsState(item, { storageUrl: session.storageUrl });
  if (state?.kind !== "convert") throw new Error("Choose a CSV file");
  if (state.disabledReason) throw new Error(state.disabledReason);
  if ((await probeSheetsWritable(session)) === false) throw new Error(SHEETS_READ_ONLY_REASON);
  const http = createPodScopedFetch(session.storageUrl, { fetch: refuseRedirects(session.fetch) });
  const response = await http(item.url);
  if (!response.ok) throw new Error("We couldn't open this file");
  const csv = await readCsv(response);
  return service.createFromCsv({ title: item.name.replace(/\.csv$/i, ""), csv });
}
