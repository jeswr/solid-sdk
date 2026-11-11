// AUTHORED-BY Codex GPT-6.1-Sol
/** Bounded, forward-only HTML tokenizer, following html-text's inert scanner approach.
 * This is a microdata reader, not a browser tree builder or HTML sanitiser. */
export const MARKUP_MAX_ELEMENTS = 50_000;
export const MARKUP_MAX_DEPTH = 32;
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}
export function decodeMarkupText(value: string): string {
  const entities: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{1,8});/gi, (whole, body: string) => {
    if (!body.startsWith("#"))
      return Object.hasOwn(entities, asciiLower(body))
        ? (entities[asciiLower(body)] as string)
        : whole;
    const hex = asciiLower(body[1] ?? "") === "x";
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : "�";
  });
}
export type HtmlMarkupToken =
  | { kind: "text"; value: string }
  | { kind: "end"; tag: string }
  | { kind: "start"; tag: string; attrs: ReadonlyMap<string, string>; void: boolean }
  | { kind: "raw"; tag: string; attrs: ReadonlyMap<string, string>; value: string };
const VOID = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);
const RAW = new Set("script style textarea title xmp iframe noembed noframes".split(" "));
const space = (c: string) => /[\t\n\f\r ]/.test(c);

/** A tag has at most 64 attributes and 16 KiB of spelling; malformed input ends the scan. */
export function* markupHtmlTokens(html: string): Generator<HtmlMarkupToken> {
  const lower = asciiLower(html);
  let i = 0;
  let elements = 0;
  while (i < html.length && elements < MARKUP_MAX_ELEMENTS) {
    if (html[i] !== "<") {
      const end = html.indexOf("<", i);
      const next = end < 0 ? html.length : end;
      yield { kind: "text", value: html.slice(i, next) };
      i = next;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      if (end < 0) return;
      i = end + 3;
      continue;
    }
    const start = i++;
    const closing = html[i] === "/";
    if (closing) i++;
    const name = i;
    while (i < html.length && /[a-z0-9]/.test(lower[i] as string)) i++;
    const tag = lower.slice(name, i);
    let quote = "";
    let end = i;
    for (; end < html.length && end - start <= 16_384; end++) {
      const c = html[end] as string;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (end >= html.length || end - start > 16_384) return;
    elements++;
    if (!tag || !/^[a-z]/.test(tag)) {
      i = end + 1;
      continue;
    }
    if (closing) {
      i = end + 1;
      yield { kind: "end", tag };
      continue;
    }
    const attrs = new Map<string, string>();
    while (i < end) {
      while (i < end && space(html[i] as string)) i++;
      if (html[i] === "/" && i + 1 === end) break;
      const begin = i;
      while (i < end && !/[\t\n\f\r =/>]/.test(html[i] as string)) i++;
      if (i === begin) {
        i++;
        continue;
      }
      const key = lower.slice(begin, i);
      while (i < end && space(html[i] as string)) i++;
      let value = "";
      if (html[i] === "=") {
        i++;
        while (i < end && space(html[i] as string)) i++;
        const q = html[i];
        if (q === '"' || q === "'") {
          const v = ++i;
          while (i < end && html[i] !== q) i++;
          value = html.slice(v, i++);
        } else {
          const v = i;
          while (i < end && !space(html[i] as string)) i++;
          value = html.slice(v, i);
        }
      }
      if (!attrs.has(key)) attrs.set(key, decodeMarkupText(value));
      if (attrs.size > 64) return;
    }
    i = end + 1;
    if (tag === "plaintext") return;
    if (RAW.has(tag)) {
      let close = lower.indexOf(`</${tag}`, i);
      while (close >= 0 && !/[\t\n\f\r />]/.test(lower[close + tag.length + 2] ?? ""))
        close = lower.indexOf(`</${tag}`, close + tag.length + 2);
      if (close < 0) return;
      yield { kind: "raw", tag, attrs, value: html.slice(i, close) };
      const after = html.indexOf(">", close + tag.length + 2);
      if (after < 0) return;
      i = after + 1;
      continue;
    }
    // HTML self-closing syntax does not close ordinary elements.
    yield { kind: "start", tag, attrs, void: VOID.has(tag) };
  }
}
