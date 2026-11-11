// AUTHORED-BY Codex GPT-6.1-Sol
import { ChannelParseError } from "./errors.js";
import { decodeEntities } from "./mastodon/entities.js";

/** Plain text only: discard active content (including unterminated blocks), then decode once. */
export function htmlToText(value: unknown): string {
  if (typeof value !== "string") throw new ChannelParseError("invalid HTML text");
  return decodeEntities(
    value
      .replace(/<(script|style)\b[^>]*(?:>|$)[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<at\b[^>]*(?:>|$)/gi, "@")
      .replace(/<br\s*\/?\s*>|<\/(?:p|div|li)\s*>/gi, "\n")
      .replace(/<[^>]*(?:>|$)/g, ""),
  )
    .replaceAll("\u00a0", " ")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" || c === "\t" ? c : ""))
    .trim();
}
