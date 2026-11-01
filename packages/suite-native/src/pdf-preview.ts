// AUTHORED-BY Claude Opus 5.5
import { SuiteNativeError } from "./errors.js";

/** Native PDF preview handoff (MOB-P3 E5). Only bytes and a display name cross this seam. */
export interface PdfPreviewPlugin {
  pdfBegin(options: { name: string; size: number }): Promise<{ handle: string }>;
  pdfChunk(options: { handle: string; data: string }): Promise<void>;
  pdfOpen(options: { handle: string }): Promise<void>;
}

/** Native code enforces the same cap on the declared size and on every append. */
export const PDF_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_PREVIEW_CHUNK_BYTES = 1024 * 1024;

export type PdfPreviewErrorCode = "too-large" | "not-pdf" | "no-viewer" | "failed";

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

/**
 * Hand a PDF to the platform viewer: QuickLook on iOS, an ACTION_VIEW intent on Android. Checks
 * the cap and the signature before anything crosses the bridge, then sends 1 MiB chunks.
 */
export async function openPdf(
  plugin: PdfPreviewPlugin,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength > PDF_PREVIEW_MAX_BYTES) throw new PdfPreviewError("too-large");
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte))
    throw new PdfPreviewError("not-pdf");
  try {
    const begun = await plugin.pdfBegin({ name, size: bytes.byteLength });
    if (typeof begun?.handle !== "string" || begun.handle.length === 0)
      throw new TypeError("handle");
    const { handle } = begun;
    for (let offset = 0; offset < bytes.byteLength; offset += PDF_PREVIEW_CHUNK_BYTES) {
      await plugin.pdfChunk({
        handle,
        data: base64(bytes.subarray(offset, offset + PDF_PREVIEW_CHUNK_BYTES)),
      });
    }
    await plugin.pdfOpen({ handle });
  } catch (error) {
    throw new PdfPreviewError(nativeCode(error));
  }
}
