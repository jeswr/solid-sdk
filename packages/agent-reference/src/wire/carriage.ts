// AUTHORED-BY Codex GPT-6
/** Temporary legacy serializer boundary. Bindings also accept writeDocument's bytes unchanged. */

import type { ByteMessage } from "../bindings/bytes.js";
import { DEFAULT_LIMITS, parseBoundedJson, resolveLimits } from "../core/limits.js";
import { ATTACHMENT_LIMITS } from "./attachments.js";
import { isMessagePacket } from "./message-packet.js";
export const DOCUMENT_MEDIA_TYPE = "application/vnd.answerable.document+json";
export const LEGACY_MEDIA_TYPE = "application/vnd.answerable.signed+json";
export function carriageBytes(wire: unknown): ByteMessage {
  return {
    bytes: new TextEncoder().encode(JSON.stringify(wire)),
    mediaType: isMessagePacket(wire) ? DOCUMENT_MEDIA_TYPE : LEGACY_MEDIA_TYPE,
  };
}
export function carriageWire(message: ByteMessage): unknown {
  if (message.mediaType === DOCUMENT_MEDIA_TYPE) {
    const wire = parseBoundedJson(
      new TextDecoder("utf-8", { fatal: true }).decode(message.bytes),
      resolveLimits({
        maxEnvelopeBytes: ATTACHMENT_LIMITS.perPacket * 1.5,
        maxStringLength: 4 * Math.ceil(ATTACHMENT_LIMITS.perAttachment / 3),
        maxArrayLength: ATTACHMENT_LIMITS.count,
      }),
    );
    if (!isMessagePacket(wire)) throw new TypeError("Malformed document carriage");
    return wire;
  }
  if (message.mediaType !== LEGACY_MEDIA_TYPE)
    throw new Error(
      "The current runtime requires its legacy signed serialization; the graph lane supplies the JSON-LD reader.",
    );
  return parseBoundedJson(
    new TextDecoder("utf-8", { fatal: true }).decode(message.bytes),
    // The wire wrapper contains an encoded envelope, whose own decoded strings are
    // checked against maxStringLength by the ordinary inbound parser.
    resolveLimits({ maxStringLength: DEFAULT_LIMITS.maxEnvelopeBytes }),
  );
}
