// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { sanitizeText } from "@jeswr/solid-chat-interop";

export class ChatModelError extends Error {
  override name = "ChatModelError";
  constructor(
    readonly code:
      | "invalid-input"
      | "missing-message"
      | "not-author"
      | "deleted"
      | "duplicate"
      | "missing-etag",
  ) {
    super(`Chat model: ${code}`);
  }
}

/** Reject rather than rewrite identifiers; RDF identity is lexical. Errors contain no input. */
export function httpIri(value: string): string {
  if (safeHttpIri(value) !== value || new URL(value).username || new URL(value).password)
    throw new ChatModelError("invalid-input");
  return value;
}
export function isoDate(value: Date): string {
  if (
    !Number.isFinite(value.getTime()) ||
    value.getUTCFullYear() < 1 ||
    value.getUTCFullYear() > 9999
  )
    throw new ChatModelError("invalid-input");
  return value.toISOString();
}
export function text(value: string): string {
  const clean = sanitizeText(value).trim();
  if (!clean) throw new ChatModelError("invalid-input");
  return clean;
}
export function segment(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new ChatModelError("invalid-input");
  return value;
}
export function strongEtag(value: string | null): string {
  if (value === null || !/^"[^"\r\n]*"$/.test(value)) throw new ChatModelError("missing-etag");
  return value;
}
