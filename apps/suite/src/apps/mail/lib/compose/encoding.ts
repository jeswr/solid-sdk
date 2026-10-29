// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { MailAddress } from "./types";
import { headerText, requireInput } from "./validation";

export const crlf = (value: string) => value.replace(/\r\n|\r|\n/g, "\r\n");
export const utf8 = (value: string) => new TextEncoder().encode(value);
export function base64(data: Uint8Array): string {
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function base64Lines(data: Uint8Array): string {
  const encoded = base64(data);
  const lines: string[] = [];
  for (let at = 0; at < encoded.length; at += 76) lines.push(encoded.slice(at, at + 76));
  return lines.join("\r\n");
}
/** Encode whole values to avoid treating literal encoded-word syntax as an instruction. */
export function encodeHeader(value: string): string {
  headerText(value, "header");
  if (
    value.length <= 60 &&
    /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(value) &&
    !value.includes("=?")
  )
    return value;
  const words: string[] = [];
  let chunk = "";
  for (const point of value) {
    if (utf8(chunk + point).length > 42) {
      words.push(`=?UTF-8?B?${base64(utf8(chunk))}?=`);
      chunk = "";
    }
    chunk += point;
  }
  if (chunk !== "") words.push(`=?UTF-8?B?${base64(utf8(chunk))}?=`);
  return words.join("\r\n ");
}
export const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
export function formatAddress(value: MailAddress): string {
  if (value.name === undefined) return value.email;
  const name = encodeHeader(value.name);
  // Expose a safe fold boundary without splitting quoted names or mailbox tokens.
  return `${name.startsWith("=?") ? name : quoted(name)}\r\n <${value.email}>`;
}
export function header(name: string, value: string): string {
  const limit = /(?:^|\r\n )=\?UTF-8\?B\?[^?]+\?=(?=\r\n |$)/.test(value) ? 76 : 78;
  const lines: string[] = [];
  let line = `${name}:`;
  for (const part of value.split("\r\n ")) {
    if (line.length + part.length + 1 > limit) {
      lines.push(line);
      line = ` ${part}`;
    } else {
      line += ` ${part}`;
    }
    // Encoded fields have a mandatory limit, even for indivisible mailbox tokens.
    requireInput(limit !== 76 || line.length <= limit, "lineLength");
  }
  lines.push(line);
  return lines.join("\r\n");
}
export function filenameParameter(filename: string): string {
  headerText(filename, "filename");
  requireInput(
    filename.length > 0 && !/[\\/]/.test(filename) && utf8(filename).length <= 180,
    "filename",
  );
  if (/^[\x20-\x7e]+$/.test(filename)) return `filename=${quoted(filename)}`;
  const bytes = utf8(filename);
  const parts: string[] = [];
  for (let at = 0; at < bytes.length; at += 15) {
    const encoded = Array.from(
      bytes.slice(at, at + 15),
      (byte) => `%${byte.toString(16).padStart(2, "0").toUpperCase()}`,
    ).join("");
    parts.push(`filename*${at / 15}*=${at === 0 ? "utf-8''" : ""}${encoded}`);
  }
  return parts.join(";\r\n ");
}
