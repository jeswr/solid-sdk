// AUTHORED-BY Codex GPT-6.2 Sol
import { gunzipSync, gzipSync } from "node:zlib";
import { ATTACHMENT_LIMITS } from "@jeswr/agent-reference/wire/attachments";
import { carriageWire, DOCUMENT_MEDIA_TYPE } from "@jeswr/agent-reference/wire/carriage";
import {
  documentConfiguration,
  type MessagePacket,
} from "@jeswr/agent-reference/wire/message-packet";
import { z } from "zod";
import type { WireMessage } from "../store/state.js";
import { DEFAULT_MIME_LIMITS } from "./mime.js";

/** Bound the serialized wrapper separately from decoded document and attachment sizes. */
export const MAX_DOCUMENT_CARRIAGE_BYTES = 1.5 * ATTACHMENT_LIMITS.perPacket;

export function readPacketCarriage(bytes: Uint8Array): MessagePacket {
  return messagePacketSchema.parse(carriageWire({ bytes, mediaType: DOCUMENT_MEDIA_TYPE }));
}

export function packEmailDocument(packet: MessagePacket): string {
  return gzipSync(JSON.stringify(packet)).toString("base64url");
}

export function unpackEmailDocument(encoded: string): MessagePacket {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new TypeError("invalid document encoding");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.toString("base64url") !== encoded) throw new TypeError("invalid document encoding");
  return readPacketCarriage(gunzipSync(bytes, { maxOutputLength: DEFAULT_MIME_LIMITS.maxBytes }));
}

export const messagePacketSchema = z.strictObject({
  format: z.literal("awp-jsonld/0.1"),
  jsonld: z.string(),
  attachments: z
    .array(
      z.strictObject({
        bytes: z.string(),
        digest: z.string(),
        mediaType: z.string(),
        byteLength: z.number().int().nonnegative().max(ATTACHMENT_LIMITS.perAttachment),
      }),
    )
    .max(ATTACHMENT_LIMITS.count),
});

/** A carriage check. The runtime verifies the proof against pinned keys. */
export function hasProof(wire: WireMessage): boolean {
  if (wire.format === "awp-jws-compact/0.1") return true;
  if (wire.format !== "awp-jsonld/0.1") return false;
  try {
    return documentConfiguration(wire).signed;
  } catch {
    return false;
  }
}

/** Only proof-free carriage can enter the anonymous public request path. */
export function isUnsignedRequest(wire: WireMessage): boolean {
  if (wire.format === "awp-unsigned-json/0.1") return true;
  if (wire.format !== "awp-jsonld/0.1") return false;
  try {
    return !documentConfiguration(wire).signed;
  } catch {
    return false;
  }
}
