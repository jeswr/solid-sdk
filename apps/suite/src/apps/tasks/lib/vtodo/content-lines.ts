// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { VTodoError, type VTodoErrorCode } from "./types";

export function requireValue(condition: unknown, code: VTodoErrorCode): asserts condition {
  if (!condition) throw new VTodoError(code);
}

export function textValue(value: unknown): asserts value is string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: RFC 5545 excludes these controls from TEXT.
  const controls = /[\u0000-\u0008\u000b-\u001f\u007f]/u;
  requireValue(
    typeof value === "string" && !controls.test(value) && value.isWellFormed(),
    "invalid-value",
  );
}

export function escapeText(value: string): string {
  textValue(value);
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function unescapeText(value: string): string {
  // Unescaped commas/semicolons and unknown/trailing escapes are invalid TEXT.
  requireValue(!/(^|[^\\])(\\\\)*[;,]/u.test(value), "invalid-value");
  requireValue(!/\\(?:[^\\nN;,]|$)/u.test(value.replace(/\\\\/g, "")), "invalid-value");
  return value.replace(/\\([\\nN;,])/g, (_, ch: string) => (/[nN]/.test(ch) ? "\n" : ch));
}

/** Strict RFC 5545 CRLF, unfolding exactly one SP/HTAB after a line break. */
export function unfoldLines(input: string): string[] {
  requireValue(typeof input === "string", "invalid-input");
  requireValue(input.isWellFormed(), "invalid-value");
  requireValue(!/(^|[^\r])\n|\r(?!\n)/u.test(input), "invalid-syntax");
  requireValue(input.endsWith("\r\n"), "invalid-syntax");
  requireValue(!/^[ \t]/u.test(input), "invalid-syntax");
  const lines = input
    .replace(/\r\n[ \t]/g, "")
    .slice(0, -2)
    .split("\r\n");
  for (const line of lines) {
    textValue(line);
    requireValue(line.length > 0, "invalid-syntax");
  }
  return lines;
}

/** Fold at 75 UTF-8 octets, counting the continuation space; never split a code point. */
export function foldLine(line: string): string {
  textValue(line);
  requireValue(!line.includes("\n"), "invalid-value");
  let result = "";
  let length = 0;
  const encoder = new TextEncoder();
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += character;
    length += bytes;
  }
  return result;
}

export interface Property {
  readonly name: string;
  readonly params: ReadonlyMap<string, string>;
  readonly value: string;
}

export function parseProperty(line: string): Property {
  // Supported parameters are simple tokens (optionally quoted). Anything else fails closed.
  const match = /^([a-z0-9-]+)((?:;[a-z0-9-]+=(?:[a-z0-9-]+|"[a-z0-9-]+"))*):([\s\S]*)$/i.exec(
    line,
  );
  requireValue(match, "invalid-syntax");
  const params = new Map<string, string>();
  for (const part of (match[2] as string).split(";").slice(1)) {
    const [key, raw] = part.split("=") as [string, string];
    const name = key.toUpperCase();
    requireValue(!params.has(name), "duplicate");
    params.set(name, raw.replace(/"/g, "").toUpperCase());
  }
  return { name: (match[1] as string).toUpperCase(), params, value: match[3] as string };
}

export function parameters(property: Property, allowed: Readonly<Record<string, string>>): void {
  for (const [key, value] of property.params) {
    requireValue(allowed[key] === value, "unsupported-parameter");
  }
}
