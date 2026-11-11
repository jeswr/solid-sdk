// AUTHORED-BY Codex GPT-6.1-Sol
import { sanitizeText } from "./iri.js";

/**
 * Remove common credential forms before persistence or upload. No diagnostics contain input.
 *
 * {@link ChatWriter} applies this to every title and message it stores, so callers that
 * redact earlier (session capture, export import) and callers that do not (MCP `chat_save`)
 * end up with the same stored text. Redacted output is a fixpoint: redacting it again
 * changes nothing, which keeps derived message IDs stable across those paths.
 */
export function redactSecrets(text: string): string {
  return (
    // Remove control characters first (tab and line breaks stay): one inside a credential
    // would defeat the patterns below and later be stripped by the serializer.
    sanitizeText(text)
      // Include an unfinished PEM block: a truncated transcript must not leak its body.
      .replace(
        /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
        "[REDACTED PRIVATE KEY]",
      )
      // Token boundaries are letters and digits only, so Markdown emphasis such as
      // `__sk-...__` or `_ghp_..._` cannot hide a credential behind a word character.
      .replace(/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]+/g, "[REDACTED TOKEN]")
      .replace(
        /(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g,
        "[REDACTED TOKEN]",
      )
      .replace(
        /(?<![A-Za-z0-9])(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
        "[REDACTED AWS KEY]",
      )
      .replace(
        /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        "[REDACTED JWT]",
      )
      .replace(/(?<![A-Za-z0-9])(?:proxy-)?authorization\s*:[^\r\n]*/gi, "[REDACTED AUTHORIZATION]")
      // Redact every shell/.env assignment, including non-secret-looking variable names,
      // multiline quoted values, unquoted backslash-newline continuations and an unfinished
      // final quote. Retain no variable value.
      .replace(
        /\b(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*(?:"[^"\\]*(?:\\[\s\S][^"\\]*)*(?:"|\\?$)|'[^']*(?:'|$)|(?:[^\r\n\\]|\\(?:\r\n|[\s\S]|$))*)/g,
        "[REDACTED ENV]",
      )
  );
}
