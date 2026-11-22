// AUTHORED-BY Codex GPT-6
/** Separate, finite bounds for a transport envelope carrying a document packet. */
import { assertJsonBounds, DEFAULT_LIMITS, resolveLimits } from "../core/limits.js";
import { ATTACHMENT_LIMITS } from "./attachments.js";
import { parseBoundedJson } from "./bounded-json.js";
import { carriageWire, DOCUMENT_MEDIA_TYPE } from "./carriage.js";
import { assertUniqueKeys } from "./document.js";
export const MAX_DOCUMENT_PACKET_BYTES = ATTACHMENT_LIMITS.perPacket * 1.5;
export const MAX_DOCUMENT_COPY_BASE64 = Math.ceil(MAX_DOCUMENT_PACKET_BYTES / 3) * 4;
const CARRIER_LIMITS = resolveLimits({
  maxEnvelopeBytes: MAX_DOCUMENT_COPY_BASE64 + DEFAULT_LIMITS.maxEnvelopeBytes,
  maxStringLength: MAX_DOCUMENT_COPY_BASE64,
});
export function readCarrierEnvelope(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = parseBoundedJson(text, CARRIER_LIMITS);
  assertUniqueKeys(text);
  const pending = [value];
  let document = false;
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    if (
      !Array.isArray(item) &&
      Object.keys(item).every((key) => key === "bytes" || key === "mediaType") &&
      (item as Record<string, unknown>).mediaType === DOCUMENT_MEDIA_TYPE &&
      typeof (item as Record<string, unknown>).bytes === "string"
    ) {
      const encoded = (item as { bytes: string }).bytes;
      if (encoded.length <= MAX_DOCUMENT_COPY_BASE64) {
        const decoded = Buffer.from(encoded, "base64");
        if (decoded.toString("base64") === encoded) {
          try {
            carriageWire({ bytes: decoded, mediaType: DOCUMENT_MEDIA_TYPE });
            document = true;
          } catch {
            // A media-type marker or an invalid copy cannot relax control bounds.
          }
        }
      }
    }
    pending.push(...Object.values(item));
  }
  // Ordinary discovery/control envelopes retain their existing bounds.
  if (!document) {
    if (Buffer.byteLength(text) > DEFAULT_LIMITS.maxEnvelopeBytes)
      return parseBoundedJson(text, DEFAULT_LIMITS);
    assertJsonBounds(value, DEFAULT_LIMITS);
  }
  return value;
}
