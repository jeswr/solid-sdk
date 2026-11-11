// AUTHORED-BY Claude Opus 5.5
import { SuiteNativeError } from "./errors.js";

/** Native PDF preview handoff (MOB-P3 E5). Only bytes and a display name cross this seam. */
export interface PdfPreviewPlugin {
  pdfBegin(options: { name: string; size: number }): Promise<{ handle: string }>;
  pdfChunk(options: { handle: string; data: string }): Promise<void>;
  pdfOpen(options: { handle: string }): Promise<void>;
  /** Drops any transfer, closes an in-app viewer and deletes every cached preview file. */
  pdfClear(): Promise<void>;
}

/** Native code enforces the same cap on the declared size and on every append. */
export const PDF_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_PREVIEW_CHUNK_BYTES = 1024 * 1024;

export type PdfPreviewErrorCode = "too-large" | "not-pdf" | "no-viewer" | "cancelled" | "failed";

/** Display names are cut to this many code points; native code bounds them too. */
export const PDF_PREVIEW_NAME_CODE_POINTS = 255;

/** Why the platform viewer could not open the file. */
export class PdfPreviewError extends SuiteNativeError {
  override readonly name = "PdfPreviewError";
  constructor(readonly code: PdfPreviewErrorCode) {
    super(`PDF preview failed (${code})`);
  }
}

const SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const KNOWN: readonly string[] = ["too-large", "not-pdf", "no-viewer"];

function nativeCode(error: unknown): PdfPreviewErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && KNOWN.includes(code)
    ? (code as PdfPreviewErrorCode)
    : "failed";
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  // Bounded argument lists: String.fromCharCode spreads each slice onto the stack.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

class Cancelled extends Error {}

/**
 * Hand a PDF to the platform viewer: QuickLook on iOS, an ACTION_VIEW intent on Android. Checks
 * the cap and the signature before anything crosses the bridge, then sends 1 MiB chunks. Aborting
 * `signal` stops before the next native call (code `cancelled`); a newer `openPdf` replaces the
 * native handle, and native code refuses the old one's calls without touching the new transfer.
 */
export async function openPdf(
  plugin: PdfPreviewPlugin,
  name: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  if (bytes.byteLength > PDF_PREVIEW_MAX_BYTES) throw new PdfPreviewError("too-large");
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte))
    throw new PdfPreviewError("not-pdf");
  const live = () => {
    if (signal?.aborted) throw new Cancelled();
  };
  try {
    live();
    const shortName = Array.from(name).slice(0, PDF_PREVIEW_NAME_CODE_POINTS).join("");
    const begun = await plugin.pdfBegin({ name: shortName, size: bytes.byteLength });
    if (typeof begun?.handle !== "string" || begun.handle.length === 0)
      throw new TypeError("handle");
    const { handle } = begun;
    for (let offset = 0; offset < bytes.byteLength; offset += PDF_PREVIEW_CHUNK_BYTES) {
      live();
      await plugin.pdfChunk({
        handle,
        data: base64(bytes.subarray(offset, offset + PDF_PREVIEW_CHUNK_BYTES)),
      });
    }
    live();
    await plugin.pdfOpen({ handle });
  } catch (error) {
    throw new PdfPreviewError(error instanceof Cancelled ? "cancelled" : nativeCode(error));
  }
}

/**
 * Sign-out or account switch: drops any transfer, closes QuickLook on iOS and deletes every
 * cached preview so the next account never sees the last one's files (sst-8wx.18). An external
 * Android viewer keeps only what it already read: the file behind its URI is gone.
 */
export async function clearPdfPreviews(plugin: PdfPreviewPlugin): Promise<void> {
  try {
    await plugin.pdfClear();
  } catch {
    throw new PdfPreviewError("failed");
  }
}
