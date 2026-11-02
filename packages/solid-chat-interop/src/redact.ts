// AUTHORED-BY Codex GPT-6.1-Sol
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
    text
      // Include an unfinished PEM block: a truncated transcript must not leak its body.
      .replace(
        /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g,
        "[REDACTED PRIVATE KEY]",
      )
      .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED TOKEN]")
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[REDACTED TOKEN]")
      .replace(/\b(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]")
      .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED JWT]")
      .replace(/\b(?:proxy-)?authorization\s*:[^\r\n]*/gi, "[REDACTED AUTHORIZATION]")
      // Redact every shell/.env assignment, including non-secret-looking variable names,
      // multiline quoted values, unquoted backslash-newline continuations and an unfinished
      // final quote. Retain no variable value.
      .replace(
        /\b(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*(?:"[^"\\]*(?:\\[\s\S][^"\\]*)*(?:"|\\?$)|'[^']*(?:'|$)|(?:[^\r\n\\]|\\(?:\r\n|[\s\S]|$))*)/g,
        "[REDACTED ENV]",
      )
  );
}
