// AUTHORED-BY Codex GPT-6
/** Carriage is opaque bytes plus a media type; envelopes never inspect the signed document. */
import { z } from "zod";
import { DEFAULT_LIMITS } from "../core/limits.js";
import { DOCUMENT_MEDIA_TYPE } from "../wire/carriage.js";
import { MAX_DOCUMENT_COPY_BASE64, readCarrierEnvelope } from "../wire/carrier-envelope.js";

export interface ByteMessage {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}
export interface HttpExchange {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}
export class CarriageError extends Error {
  constructor(
    readonly reason:
      | "malformed"
      | "bounds-exceeded"
      | "no-structured-content"
      | "conflicting-structured-copies"
      | "human-parity-mismatch"
      | "not-authorised"
      | "bad-signature",
    detail: string,
  ) {
    super(detail);
  }
}
const legacyByteCopySchema = z.strictObject({
  bytes: z
    .string()
    .max(DEFAULT_LIMITS.maxEnvelopeBytes * 2)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  mediaType: z.string().min(1).max(128),
});
export const byteCopySchema = z.union([
  legacyByteCopySchema,
  z.strictObject({
    bytes: z
      .string()
      .max(MAX_DOCUMENT_COPY_BASE64)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    mediaType: z.literal(DOCUMENT_MEDIA_TYPE),
  }),
]);
export function copyOf(message: ByteMessage) {
  return { bytes: Buffer.from(message.bytes).toString("base64"), mediaType: message.mediaType };
}
export function bytesOf(copy: unknown): ByteMessage {
  const value = byteCopySchema.parse(copy);
  return { bytes: Uint8Array.from(Buffer.from(value.bytes, "base64")), mediaType: value.mediaType };
}
export function envelopeBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
export function envelopeJson(bytes: Uint8Array): unknown {
  return readCarrierEnvelope(bytes);
}
export function oneCopy(copies: readonly ByteMessage[]): ByteMessage {
  const first = copies[0];
  if (!first)
    throw new CarriageError(
      "no-structured-content",
      "The carriage contains no signed structured part.",
    );
  if (
    copies.some(
      (copy) =>
        copy.mediaType !== first.mediaType ||
        !Buffer.from(copy.bytes).equals(Buffer.from(first.bytes)),
    )
  )
    throw new CarriageError("conflicting-structured-copies", "The structured copies differ.");
  return first;
}
