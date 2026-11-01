// AUTHORED-BY Claude Opus 5.5
/**
 * Readable plain-text fallback for HTML-only mail; never an HTML sanitiser (the original HTML
 * is stored separately as inert data). One left-to-right pass over at most MAX_HTML_CHARS:
 * every index is visited a bounded number of times, so hostile markup cannot cause rescans.
 */
export const MAX_HTML_CHARS = 1024 * 1024;

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
  if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()];
  const hex = name[1] === "x" || name[1] === "X";
  const digits = name.slice(hex ? 2 : 1);
  if (!digits || !(hex ? /^[\da-f]+$/i : /^\d+$/).test(digits)) return undefined;
  const code = Number.parseInt(digits, hex ? 16 : 10);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : "�";
}

export function htmlToText(input: string): string {
  const html = input.length > MAX_HTML_CHARS ? input.slice(0, MAX_HTML_CHARS) : input;
  const lower = html.toLowerCase();
  let out = "";
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
      if (tag && BLOCK.has(tag)) out += "\n";
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
          out += decoded;
          i += semi + 2;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out
    .replace(/[ \t\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
