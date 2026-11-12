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

/** Characters that render as nothing or as layout, so a preview could hide text with them. */
const INVISIBLE =
  /[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\u115F\u1160\u3164\uFFA0]/u;

/**
 * Preserve text exactly; unsupported controls/line endings refuse instead of being hidden.
 * Emoji sequences survive: a variation selector only directly after a pictograph (or a keycap
 * base), and a zero-width joiner only between pictographs. Everything else that renders as
 * nothing (bidi and format controls, other variation selectors, Hangul fillers, the braille
 * blank, line/paragraph separators, private use) refuses.
 */
export function previewText(value: unknown): string {
  if (typeof value !== "string" || /[\uD800-\uDFFF]/u.test(value))
    throw new ChannelParseError("invalid preview text");
  const visible = value
    .replace(/(?<=[0-9#*])\uFE0F(?=\u20E3)/gu, "")
    .replace(/(?<=\p{Extended_Pictographic}\p{Emoji_Modifier}?)[\uFE0E\uFE0F]/gu, "")
    .replace(
      /(?<=\p{Extended_Pictographic}\p{Emoji_Modifier}?)\u200D(?=\p{Extended_Pictographic})/gu,
      "",
    )
    .replace(/[\n\t]/g, "");
  if (INVISIBLE.test(visible)) throw new ChannelParseError("invalid preview text");
  return value;
}

/** Fixed heading before the signed message, so its JSON can't pass for the human text. */
export const SIGNED_MESSAGE_HEADING = "Signed message sent to the recipient's agent:";

/**
 * The signed message itself, as canonical JSON of the raw JWS payload. Envelope carriages
 * deliver all of it to the recipient's agent, so the owner approves all of it, not a summary.
 */
export function signedMessage(compactJws: string, maxBytes: number): string {
  let json: string;
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compactJws)) throw new Error();
    const payload = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(compactJws.split(".")[1] as string, "base64url"),
    );
    json = canonicalJson(
      parseBoundedJson(payload, {
        ...DEFAULT_LIMITS,
        maxEnvelopeBytes: maxBytes,
        maxStringLength: maxBytes,
      }),
    );
  } catch {
    throw new ChannelParseError("invalid signed message preview");
  }
  return previewText(json);
}

/** Human-visible text, then the complete signed message the envelope carries. */
export function withSignedMessage(text: string, compactJws: string, maxBytes: number): string {
  return `${text}\n\n${SIGNED_MESSAGE_HEADING}\n${signedMessage(compactJws, maxBytes)}`;
}

/** Closed-world objects: an unreviewed field could change what is sent. */
export function exactKeys(value: Record<string, unknown>, keys: readonly string[], what: string) {
  const own = Object.keys(value).sort();
  if (own.join("\u0000") !== [...keys].sort().join("\u0000"))
    throw new ChannelParseError(`unsupported ${what} preview fields`);
}
