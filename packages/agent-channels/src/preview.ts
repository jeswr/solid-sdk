// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson, DEFAULT_LIMITS, digestBytes, parseBoundedJson } from "@jeswr/agent-model";
import { ChannelParseError } from "./errors.js";
import type { Wire } from "./types.js";

/** Snapshot data properties before parsing. Never evaluate hostile wire getters. */
export function previewBytes(wire: Wire, mediaType: string, maxBytes: number): string {
  try {
    const keys = Reflect.ownKeys(wire);
    if (keys.length !== 3) throw new Error();
    const fields = Object.getOwnPropertyDescriptors(wire);
    for (const key of ["bytes", "mediaType", "digest"])
      if (!fields[key] || !("value" in fields[key])) throw new Error();
    const data = fields as Record<"bytes" | "mediaType" | "digest", { value: unknown }>;
    const bytes = data.bytes.value;
    if (
      typeof bytes !== "string" ||
      bytes.length > maxBytes ||
      Buffer.byteLength(bytes) > maxBytes ||
      /[\uD800-\uDFFF]/u.test(bytes) ||
      data.mediaType.value !== mediaType ||
      data.digest.value !== digestBytes(bytes)
    )
      throw new Error();
    return bytes;
  } catch {
    throw new ChannelParseError("invalid preview wire");
  }
}

/** Renderers emit canonical JSON. Refuse duplicate keys and unsupported alternate encodings. */
export function previewJson(wire: Wire, mediaType: string, maxBytes: number) {
  const bytes = previewBytes(wire, mediaType, maxBytes);
  try {
    const value = parseBoundedJson(bytes, {
      ...DEFAULT_LIMITS,
      maxEnvelopeBytes: maxBytes,
      maxStringLength: maxBytes,
    });
    if (canonicalJson(value) !== bytes) throw new Error();
    return previewObject(value);
  } catch {
    throw new ChannelParseError("invalid preview JSON");
  }
}

export function previewObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("invalid preview object");
  return value as Record<string, unknown>;
}

/**
 * Preserve text exactly; unsupported controls/line endings refuse instead of being hidden.
 * The zero-width joiner is allowed so emoji sequences survive; bidi and other format
 * controls still refuse.
 */
export function previewText(value: unknown): string {
  if (
    typeof value !== "string" ||
    /[\uD800-\uDFFF]/u.test(value) ||
    /[\p{Cc}\p{Cf}]/u.test(value.replace(/[\n\t\u200D]/g, ""))
  )
    throw new ChannelParseError("invalid preview text");
  return value;
}
