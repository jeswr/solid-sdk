// AUTHORED-BY Codex GPT-6
import { canonicalJson } from "../core/canonical.js";

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

/** Bounded UTF-8 JSON with duplicate member names and non-finite numbers refused. */
export function strictJson(value: string | Uint8Array, maxBytes = 65_536): unknown {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("invalid size limit");
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  if (bytes.length > maxBytes) throw new Error("JSON too large");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const result: unknown = JSON.parse(text, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item))
      throw new Error("non-finite JSON number");
    return item;
  });
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{") stack.push(new Set());
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') break;
        else i++;
      }
      let next = i + 1;
      while (/\s/.test(text[next] ?? "x")) next++;
      const names = stack.at(-1);
      if (text[next] === ":" && names) {
        const key: string = JSON.parse(text.slice(start, i + 1));
        if (names.has(key)) throw new Error("duplicate JSON member");
        names.add(key);
      }
    }
  }
  return result;
}

export function encodeJson(value: unknown, encoding: "base64" | "base64url"): string {
  return encoding === "base64" ? base64(canonicalJson(value)) : base64url(canonicalJson(value));
}

export function decodeJson(value: string, encoding: "base64" | "base64url"): unknown {
  return strictJson(encoding === "base64" ? decodeBase64(value) : decodeBase64url(value));
}
