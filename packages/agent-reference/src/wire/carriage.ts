// AUTHORED-BY Codex GPT-6
/** Temporary legacy serializer boundary. Bindings also accept writeDocument's bytes unchanged. */
import type { ByteMessage } from "../bindings/bytes.js";
import { DEFAULT_LIMITS, parseBoundedJson } from "../core/limits.js";
export const LEGACY_MEDIA_TYPE = "application/vnd.answerable.signed+json";
export function carriageBytes(wire: unknown): ByteMessage {
  return { bytes: new TextEncoder().encode(JSON.stringify(wire)), mediaType: LEGACY_MEDIA_TYPE };
}
export function carriageWire(message: ByteMessage): unknown {
  if (message.mediaType !== LEGACY_MEDIA_TYPE)
    throw new Error(
      "The current runtime requires its legacy signed serialization; the graph lane supplies the JSON-LD reader.",
    );
  return parseBoundedJson(
    new TextDecoder("utf-8", { fatal: true }).decode(message.bytes),
    DEFAULT_LIMITS,
  );
}
