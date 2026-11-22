// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "../core/canonical.js";
import { strictJson } from "../wire/strict-json.js";

export interface HttpExchange {
  method: string;
  path: string;
  status?: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Duplicate spellings are ambiguous, even when their values happen to agree. */
export function header(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const matches = Object.keys(headers).filter((key) => key.toLowerCase() === name.toLowerCase());
  if (matches.length > 1) throw new Error("ambiguous header");
  return matches.length ? headers[matches[0] as string] : undefined;
}

export function base64(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

export function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string, encoding: "base64" | "base64url", maxBytes: number): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("invalid size limit");
  if (value.length > Math.ceil(maxBytes / 3) * 4) throw new Error("encoded value too large");
  const pattern =
    encoding === "base64"
      ? /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
      : /^[A-Za-z0-9_-]*$/;
  if (!pattern.test(value)) throw new Error("invalid base64 encoding");
  const bytes = Buffer.from(value, encoding);
  if (bytes.length > maxBytes) throw new Error("encoded value too large");
  if (bytes.toString(encoding) !== value) throw new Error("noncanonical base64 encoding");
  return bytes;
}

export function decodeBase64(value: string, maxBytes = 65_536): Uint8Array {
  return decode(value, "base64", maxBytes);
}

export function decodeBase64url(value: string, maxBytes = 65_536): Uint8Array {
  return decode(value, "base64url", maxBytes);
}

export { strictJson } from "../wire/strict-json.js";

export function encodeJson(value: unknown, encoding: "base64" | "base64url"): string {
  return encoding === "base64" ? base64(canonicalJson(value)) : base64url(canonicalJson(value));
}

export function decodeJson(value: string, encoding: "base64" | "base64url"): unknown {
  return strictJson(encoding === "base64" ? decodeBase64(value) : decodeBase64url(value));
}
