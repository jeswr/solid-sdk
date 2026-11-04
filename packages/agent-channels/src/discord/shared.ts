// AUTHORED-BY Codex GPT-6.1-Sol
import { DEFAULT_LIMITS, parseBoundedJson } from "@jeswr/agent-model";
import { ChannelParseError } from "../errors.js";

/** Private origin sources; exported sets cannot widen credential destinations. */
export const discordOrigins = () => new Set(["https://discord.com", "wss://gateway.discord.gg"]);
export const GATEWAY_ORIGIN = "wss://gateway.discord.gg";
export const MAX_EVENT_BYTES = 64 * 1024;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChannelParseError("invalid Discord object");
  return value as Record<string, unknown>;
}
export function snowflake(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value) ||
    BigInt(value) > 2n ** 64n - 1n
  )
    throw new ChannelParseError("invalid Discord snowflake");
  return value;
}
export function readJson(raw: string | Uint8Array): {
  text: string;
  value: Record<string, unknown>;
} {
  try {
    if (Buffer.byteLength(raw) > MAX_EVENT_BYTES) throw new Error("cap");
    const text =
      typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { text, value: record(parseBoundedJson(text, DEFAULT_LIMITS)) };
  } catch {
    throw new ChannelParseError("invalid Discord JSON");
  }
}
/** Stored as plain text; no embed HTML, remote attachments or structured payloads. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max)
    throw new ChannelParseError("invalid Discord text");
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" || c === "\t" ? c : ""));
}
