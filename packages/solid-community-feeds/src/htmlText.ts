// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see prod-solid-server docs/MODEL-PROVENANCE.md
// AUTHORED-BY Claude Opus 5.5
/**
 * Minimal, dependency-free HTML → plain-text reduction for the unified body.
 *
 * Discourse posts arrive as `cooked` HTML and Matrix messages may carry an
 * HTML `formatted_body`. The unified `CommunityMessage.body` is plain text; the
 * original HTML is preserved separately in `bodyHtml`. This is NOT a sanitiser
 * (the caller must sanitise `bodyHtml` before rendering it as HTML); it only
 * derives a readable text snippet for list views.
 *
 * Deliberately simple (no parser dependency): strip tags, decode the handful of
 * common entities, collapse whitespace. Block-level tags become newlines so
 * paragraphs/line breaks survive as text. Linear-time: the input is attacker
 * controlled (any Matrix room member writes `formatted_body`).
 */

/**
 * Maximum scanned input, in UTF-16 code units. A Matrix event is at most 64 KiB
 * and a Discourse body is capped at 5 MiB by the safe fetch; the text is a
 * list-view snippet, so a longer input is cut rather than scanned.
 */
export const MAX_HTML_INPUT_CHARS = 1024 * 1024;

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
const SKIPPED = new Set(["script", "style"]);

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTML keywords are ASCII case-insensitive; Unicode folding could shift offsets. */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

/** Decode one entity body (between `&` and `;`), or `undefined` to keep it literally. */
function entity(name: string): string | undefined {
  if (!name.startsWith("#")) return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : undefined;
  const hex = name[1] === "x" || name[1] === "X";
  const digits = name.slice(hex ? 2 : 1);
  if (!digits || !(hex ? /^[\da-f]+$/i : /^\d+$/).test(digits)) return undefined;
  return safeFromCodePoint(Number.parseInt(digits, hex ? 16 : 10));
}

/**
 * One left-to-right pass over a bounded input: each index is visited a bounded
 * number of times, so hostile markup (an unclosed `<` run, say) cannot force
 * the rescans a backtracking regex would. A `<` with no `>` after it is kept as
 * text; an unclosed script/style drops the rest of the input.
 */
export function htmlToText(input: string): string {
  if (input === "") {
    return "";
  }
  // Do not cut a surrogate pair in half at the cap.
  const cut =
    input.length > MAX_HTML_INPUT_CHARS &&
    /[\uD800-\uDBFF]/.test(input[MAX_HTML_INPUT_CHARS - 1] ?? "")
      ? MAX_HTML_INPUT_CHARS - 1
      : MAX_HTML_INPUT_CHARS;
  const html = input.length > MAX_HTML_INPUT_CHARS ? input.slice(0, cut) : input;
  const lower = asciiLower(html);
  const parts: string[] = [];
  // Once no `>` follows some index, none follows any later index either.
  let noCloseFrom = html.length;
  let i = 0;
  while (i < html.length) {
    const ch = html[i] as string;
    if (ch === "<" && i < noCloseFrom) {
      const close = html.indexOf(">", i + 1);
      if (close === -1) {
        noCloseFrom = i;
      } else {
        const tag = /^\/?([a-z][a-z0-9]*)/.exec(lower.slice(i + 1, Math.min(close, i + 13)))?.[1];
        const closing = html[i + 1] === "/";
        i = close + 1;
        if (tag !== undefined && BLOCK.has(tag)) parts.push("\n");
        if (tag !== undefined && SKIPPED.has(tag) && !closing) {
          const end = lower.indexOf(`</${tag}`, i);
          if (end === -1) break;
          const after = html.indexOf(">", end);
          i = after === -1 ? html.length : after + 1;
        }
        continue;
      }
    }
    if (ch === "&") {
      // Bounded look-ahead: a run of bare "&" must not rescan the rest of the input.
      const semi = html.slice(i + 1, i + 13).indexOf(";");
      if (semi !== -1) {
        const decoded = entity(html.slice(i + 1, i + 1 + semi));
        if (decoded !== undefined) {
          parts.push(decoded);
          i += semi + 2;
          continue;
        }
      }
    }
    parts.push(ch);
    i++;
  }
  // Collapse runs of blank lines + trim whitespace per line.
  return parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return "";
  }
  return String.fromCodePoint(cp);
}
