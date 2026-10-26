// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Readable plain-text fallback for HTML-only mail; never an HTML sanitiser (the original HTML
 * is stored separately as inert data). One left-to-right pass over a bounded input window:
 * every index is visited a bounded number of times, so hostile markup cannot cause rescans.
 * Normalize whitespace before capping visible text; skipped markup never consumes that cap.
 */
/** Maximum returned visible text, in UTF-16 code units (excluding a caller's notice). */
export const MAX_HTML_CHARS = 1024 * 1024;
/** Maximum scanned input: 8,388,608 UTF-16 code units, bounding work and intermediate text. */
export const MAX_HTML_INPUT_CHARS = 8 * 1024 * 1024;
export const HTML_TEXT_TRUNCATION_NOTICE =
  "[Message text truncated. The full HTML and the original message are kept with this email.]";

/** HTML keywords are ASCII case-insensitive. Unicode folding can change string offsets. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

/** Avoid cutting a valid astral character in half at either boundary. */
function prefix(value: string, limit: number): string {
  const high = value.charCodeAt(limit - 1);
  const low = value.charCodeAt(limit);
  const end =
    high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? limit - 1 : limit;
  return value.slice(0, end);
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const BLOCK = new Set([
  "p",
  "div",
  "br",
  "li",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
]);
const SKIPPED = new Set(["script", "style", "head"]);

function entity(name: string): string | undefined {
  if (!name.startsWith("#")) return ENTITIES[asciiLower(name)];
  const hex = name[1] === "x" || name[1] === "X";
  const digits = name.slice(hex ? 2 : 1);
  if (!digits || !(hex ? /^[\da-f]+$/i : /^\d+$/).test(digits)) return undefined;
  const code = Number.parseInt(digits, hex ? 16 : 10);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : "�";
}

export function htmlToTextResult(input: string): { text: string; truncated: boolean } {
  const html = prefix(input, MAX_HTML_INPUT_CHARS);
  const lower = asciiLower(html);
  // Flush small chunks rather than retaining one string-concatenation node per input character.
  const chunks: string[] = [];
  let out = "";
  function append(text: string): void {
    out += text;
    if (out.length >= 4096) {
      chunks.push(out);
      out = "";
    }
  }
  let i = 0;
  while (i < html.length) {
    const ch = html[i] as string;
    if (ch === "<") {
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i + 4);
        i = end === -1 ? html.length : end + 3;
        continue;
      }
      const close = html.indexOf(">", i + 1);
      if (close === -1) break; // An unterminated tag ends the readable text.
      const closing = html[i + 1] === "/";
      const tag = /^\/?([a-z][a-z0-9]*)/.exec(lower.slice(i + 1, Math.min(close, i + 12)))?.[1];
      i = close + 1;
      if (tag && BLOCK.has(tag)) append("\n");
      if (tag && SKIPPED.has(tag) && !closing) {
        const end = lower.indexOf(`</${tag}`, i);
        if (end === -1) break;
        const after = html.indexOf(">", end);
        i = after === -1 ? html.length : after + 1;
      }
      continue;
    }
    if (ch === "&") {
      // Bounded look-ahead: a run of bare "&" must not rescan the rest of the input.
      const semi = html.slice(i + 1, i + 13).indexOf(";");
      if (semi !== -1) {
        const decoded = entity(html.slice(i + 1, i + 1 + semi));
        if (decoded !== undefined) {
          append(decoded);
          i += semi + 2;
          continue;
        }
      }
    }
    append(ch);
    i++;
  }
  chunks.push(out);
  const text = chunks
    .join("")
    .replace(/[ \t\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    text: prefix(text, MAX_HTML_CHARS),
    truncated: input.length > MAX_HTML_INPUT_CHARS || text.length > MAX_HTML_CHARS,
  };
}

/** Compatibility API: callers storing this fallback should use the result to surface truncation. */
export function htmlToText(input: string): string {
  return htmlToTextResult(input).text;
}

/**
 * The stored plain-text body for a message: its own text part when present, otherwise the HTML
 * fallback with the truncation notice appended on its own paragraph when a bound was hit.
 */
export function mailBodyText(
  text: string | undefined,
  html: string | undefined,
): { body: string | undefined; truncated: boolean } {
  if (text !== undefined || html === undefined) return { body: text, truncated: false };
  const fallback = htmlToTextResult(html);
  if (!fallback.truncated) return { body: fallback.text, truncated: false };
  const body = fallback.text
    ? `${fallback.text}\n\n${HTML_TEXT_TRUNCATION_NOTICE}`
    : HTML_TEXT_TRUNCATION_NOTICE;
  return { body, truncated: true };
}
