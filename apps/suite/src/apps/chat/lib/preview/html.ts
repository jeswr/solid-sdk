// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { PreviewError } from "./errors";

export const MAX_PREVIEW_HTML_BYTES = 512 * 1024;
export const MAX_PREVIEW_TAGS = 4096;

const SPACE = /[\t\n\f\r ]/;
const VOID = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);
const HEAD = new Set(["title", "meta", "link", "script", "style"]);
const UNSUPPORTED = new Set(
  "base svg math template noscript xmp iframe noembed noframes plaintext listing".split(" "),
);
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: "\u00a0",
};
// HTML names that can consume a prefix without a semicolon. Detect them only to reject
// unsupported references; they remain literal in attributes before ASCII alphanumerics or '='.
// https://html.spec.whatwg.org/entities.json (the 106 names without a trailing semicolon).
const LEGACY_REFERENCE_PREFIX = new RegExp(
  `^(?:${[
    "AElig|AMP|Aacute|Acirc|Agrave|Aring|Atilde|Auml|COPY|Ccedil|ETH|Eacute|Ecirc|Egrave|Euml|GT",
    "Iacute|Icirc|Igrave|Iuml|LT|Ntilde|Oacute|Ocirc|Ograve|Oslash|Otilde|Ouml|QUOT|REG|THORN",
    "Uacute|Ucirc|Ugrave|Uuml|Yacute|aacute|acirc|acute|aelig|agrave|amp|aring|atilde|auml",
    "brvbar|ccedil|cedil|cent|copy|curren|deg|divide|eacute|ecirc|egrave|eth|euml|frac12|frac14|frac34",
    "gt|iacute|icirc|iexcl|igrave|iquest|iuml|laquo|lt|macr|micro|middot|nbsp|not|ntilde|oacute",
    "ocirc|ograve|ordf|ordm|oslash|otilde|ouml|para|plusmn|pound|quot|raquo|reg|sect|shy|sup1|sup2",
    "sup3|szlig|thorn|times|uacute|ucirc|ugrave|uml|uuml|yacute|yen|yuml",
  ].join("|")})`,
);

/** A deliberately explicit entity subset, decoded once, never recursively. */
export function decodeValue(value: string, inAttribute: boolean): string {
  return value.replace(
    /&(?:#[^;\s<&]*;?|[a-z][a-z0-9]*;?)/gi,
    (reference: string, offset: number) => {
      const terminated = reference.endsWith(";");
      const key = reference.slice(1, terminated ? -1 : undefined);
      if (!key.startsWith("#")) {
        if (!terminated) {
          const legacy = LEGACY_REFERENCE_PREFIX.exec(key);
          if (
            !legacy ||
            (inAttribute && /[=a-z0-9]/i.test(value.charAt(offset + 1 + legacy[0].length)))
          ) {
            return reference;
          }
          throw new PreviewError("invalid-html");
        }
        if (!Object.hasOwn(ENTITIES, key)) throw new PreviewError("invalid-html");
        return ENTITIES[key] as string;
      }
      if (!terminated) throw new PreviewError("invalid-html");
      if (!/^#(?:x[0-9a-f]+|[0-9]+)$/i.test(key)) throw new PreviewError("invalid-html");
      const hex = key.charAt(1).toLowerCase() === "x";
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point === 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff) ||
        (point < 32 && ![9, 10, 12, 13].includes(point)) ||
        (point >= 127 && point <= 159)
      ) {
        throw new PreviewError("invalid-html");
      }
      return String.fromCodePoint(point);
    },
  );
}

interface Tag {
  name: string;
  closing: boolean;
  attributes: Map<string, string>;
  end: number;
}

function readTag(html: string, start: number): Tag {
  const prefix = /^<(\/?)([a-z][a-z0-9-]*)/i.exec(html.slice(start));
  if (!prefix) throw new PreviewError("invalid-html");
  const name = (prefix[2] as string).toLowerCase();
  const closing = prefix[1] === "/";
  const attributes = new Map<string, string>();
  let cursor = start + prefix[0].length;
  while (cursor < html.length) {
    const before = cursor;
    while (SPACE.test(html.charAt(cursor))) cursor++;
    if (html.charAt(cursor) === ">") return { name, closing, attributes, end: cursor + 1 };
    if (!closing && html.startsWith("/>", cursor) && VOID.has(name)) {
      return { name, closing, attributes, end: cursor + 2 };
    }
    if (closing || cursor === before) throw new PreviewError("invalid-html");
    const attribute = /^[a-z_:][a-z0-9_.:-]*/i.exec(html.slice(cursor));
    if (!attribute) throw new PreviewError("invalid-html");
    const key = attribute[0].toLowerCase();
    if (attributes.has(key)) throw new PreviewError("invalid-html");
    cursor += attribute[0].length;
    // Keep the separator for the next attribute when this is a boolean attribute.
    const afterName = cursor;
    while (SPACE.test(html.charAt(cursor))) cursor++;
    let value = "";
    if (html.charAt(cursor) === "=") {
      cursor++;
      while (SPACE.test(html.charAt(cursor))) cursor++;
      const quote = html.charAt(cursor);
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, cursor + 1);
        if (end < 0) throw new PreviewError("invalid-html");
        value = html.slice(cursor + 1, end);
        cursor = end + 1;
      } else {
        const unquoted = /^[^\t\n\f\r "'`=<>]+/.exec(html.slice(cursor));
        if (!unquoted) throw new PreviewError("invalid-html");
        value = unquoted[0];
        cursor += value.length;
      }
    } else {
      cursor = afterName;
    }
    attributes.set(key, value);
  }
  throw new PreviewError("invalid-html");
}

export interface MetadataTag {
  name: string;
  attributes: Map<string, string>;
  text: string;
}

/** Read explicit head documents or metadata-only fragments; never emulate HTML5 error recovery. */
export function readMetadataTags(html: string): MetadataTag[] {
  if (typeof html !== "string") throw new PreviewError("invalid-html");
  // Check code units first so a huge string is rejected before UTF-8 allocation.
  if (
    html.length > MAX_PREVIEW_HTML_BYTES ||
    new TextEncoder().encode(html).length > MAX_PREVIEW_HTML_BYTES
  ) {
    throw new PreviewError("input-too-large");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls rather than repairing HTML.
  if (!html.isWellFormed() || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(html)) {
    throw new PreviewError("invalid-html");
  }
  const result: MetadataTag[] = [];
  const stack: string[] = [];
  const seen = new Set<string>();
  let count = 0;
  let cursor = 0;
  const charge = () => {
    if (++count > MAX_PREVIEW_TAGS) throw new PreviewError("too-many-tags");
  };
  while (cursor < html.length) {
    if (html.charAt(cursor) !== "<") {
      const next = html.indexOf("<", cursor);
      const end = next < 0 ? html.length : next;
      if (!stack.includes("body") && html.slice(cursor, end).trim()) {
        throw new PreviewError("invalid-html");
      }
      cursor = end;
      continue;
    }
    charge();
    if (html.startsWith("<!--", cursor)) {
      const end = html.indexOf("-->", cursor + 4);
      const content = html.slice(cursor + 4, end);
      if (end < 0 || /--|^>|^->|-$/.test(content)) {
        throw new PreviewError("invalid-html");
      }
      cursor = end + 3;
      continue;
    }
    const doctype = /^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/i.exec(html.slice(cursor));
    if (doctype) {
      if (seen.size || stack.length || result.length) throw new PreviewError("invalid-html");
      seen.add("doctype");
      cursor += doctype[0].length;
      continue;
    }
    const tag = readTag(html, cursor);
    seen.add("element");
    cursor = tag.end;
    if (UNSUPPORTED.has(tag.name)) throw new PreviewError("invalid-html");
    if (tag.closing) {
      if (stack.pop() !== tag.name) throw new PreviewError("invalid-html");
      continue;
    }
    const inBody = stack.includes("body");
    const parent = stack.at(-1);
    if (["html", "head", "body"].includes(tag.name)) {
      if (
        seen.has(tag.name) ||
        (tag.name !== "html" && seen.has("html") && parent !== "html") ||
        (result.length > 0 && !seen.has("head")) ||
        (tag.name === "html" && (parent !== undefined || seen.has("head") || seen.has("body"))) ||
        (tag.name !== "html" && parent !== undefined && parent !== "html") ||
        (tag.name === "head" && seen.has("body"))
      )
        throw new PreviewError("invalid-html");
      seen.add(tag.name);
    } else if (
      !inBody &&
      (!HEAD.has(tag.name) ||
        parent === "html" ||
        seen.has("body") ||
        (parent === undefined && (seen.has("head") || seen.has("html"))))
    ) {
      throw new PreviewError("invalid-html");
    }
    if (["title", "script", "style", "textarea"].includes(tag.name)) {
      const ending = new RegExp(`</${tag.name}(?=[\\t\\n\\f\\r />])`, "gi");
      ending.lastIndex = cursor;
      const close = ending.exec(html);
      if (!close) throw new PreviewError("invalid-html");
      const closing = readTag(html, close.index);
      const text = html.slice(cursor, close.index);
      // HTML script double-escape states are outside this subset.
      if (tag.name === "script" && /<!--|<script[\t\n\f\r />]/i.test(text)) {
        throw new PreviewError("invalid-html");
      }
      charge();
      cursor = closing.end;
      if (!inBody && tag.name === "title") result.push({ ...tag, text });
    } else {
      if (!inBody && (tag.name === "meta" || tag.name === "link"))
        result.push({ ...tag, text: "" });
      if (!VOID.has(tag.name)) stack.push(tag.name);
    }
  }
  if (stack.length) throw new PreviewError("invalid-html");
  return result;
}
