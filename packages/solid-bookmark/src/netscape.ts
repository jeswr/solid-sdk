// AUTHORED-BY Codex (GPT-6.1 Sol)
/** Inert Netscape bookmark interchange. No imported markup is rendered or fetched. */
import type { BookmarkData } from "./bookmark.js";
import { isHttpIri } from "./iri.js";

interface Token {
  name: string;
  end?: boolean;
  text?: string;
  attrs?: Record<string, string>;
}
interface HtmlNode {
  nodeType: number;
  nodeValue: string | null;
  nodeName: string;
  childNodes: ArrayLike<HtmlNode>;
  attributes?: ArrayLike<{ name: string; value: string }>;
}
interface HtmlParser {
  parseFromString(html: string, type: "text/html"): { body: HtmlNode };
}
const named: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "©",
  reg: "®",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  pound: "£",
};
// HTML's Latin-1 names are common in older browser exports which predate UTF-8.
const latinNames =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(
    " ",
  );
for (const [index, name] of latinNames.entries()) named[name] = String.fromCodePoint(160 + index);
function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, key: string) => {
    if (!key.startsWith("#")) return Object.hasOwn(named, key) ? (named[key] as string) : whole;
    const value =
      key[1]?.toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value)
      : "�";
  });
}
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (value) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value] as string,
  );
}
const allowed = new Set(["a", "h3", "dl", "dd", "dt", "p", "br"]);
const attributes = new Set(["href", "add_date", "tags", "description", "notes", "archived"]);

/** Tolerates missing closing tags, mixed case and quoted '>' characters. */
function tokenize(html: string, decodeEntities: boolean): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let ignored: string | undefined;
  while (index < html.length) {
    if (tokens.length > 100_000)
      throw new RangeError("Bookmark export contains too many HTML tokens");
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[index] !== "<") {
      const next = html.indexOf("<", index);
      const end = next < 0 ? html.length : next;
      if (!ignored)
        tokens.push({
          name: "#text",
          text: decodeEntities ? decode(html.slice(index, end)) : html.slice(index, end),
        });
      index = end;
      continue;
    }
    let end = index + 1;
    let quote = "";
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    const raw = html.slice(index + 1, end);
    index = end + 1;
    const match = /^\s*(\/?)\s*([\w-]+)/.exec(raw);
    if (!match) continue;
    const name = (match[2] as string).toLowerCase();
    const closing = match[1] === "/";
    if (ignored) {
      if (closing && name === ignored) ignored = undefined;
      continue;
    }
    if (["script", "style", "iframe", "template"].includes(name) && !closing) {
      ignored = name;
      continue;
    }
    if (!allowed.has(name)) continue;
    const attrs: Record<string, string> = Object.create(null);
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    pattern.lastIndex = match[0].length;
    for (let attr = pattern.exec(raw); attr; attr = pattern.exec(raw)) {
      const key = (attr[1] as string).toLowerCase();
      if (attributes.has(key) && attrs[key] === undefined)
        attrs[key] = decodeEntities
          ? decode(attr[2] ?? attr[3] ?? attr[4] ?? "")
          : (attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    tokens.push({ name, end: closing, attrs });
  }
  return tokens;
}

function parseTokens(html: string): Token[] {
  const Parser = (globalThis as unknown as { DOMParser?: new () => HtmlParser }).DOMParser;
  const tokens = tokenize(html, !Parser);
  if (!Parser) return tokens;
  // Only known inert tags/attributes reach DOMParser: no images, styles or executable HTML.
  // Preserve entity references for the platform's complete HTML entity decoder.
  const inertText = (text: string) => escapeHtml(text).replace(/&amp;/g, "&");
  const safe = tokens
    .map((token) =>
      token.text !== undefined
        ? inertText(token.text)
        : `<${token.end ? "/" : ""}${token.name}${
            token.end
              ? ""
              : Object.entries(token.attrs ?? {})
                  .map(([key, value]) => ` ${key}="${inertText(value)}"`)
                  .join("")
          }>`,
    )
    .join("");
  const document = new Parser().parseFromString(safe, "text/html");
  const normalized: Token[] = [];
  const visit = (node: HtmlNode, depth = 0) => {
    if (depth > 128) throw new RangeError("Bookmark folders are nested too deeply");
    if (node.nodeType === 3) {
      normalized.push({ name: "#text", text: node.nodeValue ?? "" });
      return;
    }
    const name = node.nodeName.toLowerCase();
    const attrs = Object.fromEntries(
      Array.from(node.attributes ?? [], (attr) => [attr.name, attr.value]),
    );
    if (allowed.has(name)) normalized.push({ name, attrs });
    for (const child of Array.from(node.childNodes)) visit(child, depth + 1);
    if (allowed.has(name)) normalized.push({ name, end: true });
  };
  visit(document.body);
  return normalized;
}

export interface NetscapeImport {
  bookmarks: BookmarkData[];
  /** Invalid or non-http(s) links; the caller can explain omissions. */
  skipped: number;
}

/** Folders become tags. Invalid dates are omitted; unsafe/missing URLs are skipped. */
export function parseNetscapeBookmarks(html: string): NetscapeImport {
  if (html.length > 10_000_000) throw new RangeError("Bookmark export exceeds 10 MB");
  const result: NetscapeImport = { bookmarks: [], skipped: 0 };
  const folders: (string | undefined)[] = [];
  let folder: string | undefined;
  let capture: { name: string; text: string; attrs: Record<string, string> } | undefined;
  let previous: BookmarkData | undefined;
  const finish = () => {
    if (!capture) return;
    const { name, text, attrs } = capture;
    capture = undefined;
    if (name === "h3") {
      folder = text.trim();
      return;
    }
    if (name === "dd") {
      if (previous && !previous.description) previous.description = text.trim() || undefined;
      return;
    }
    previous = undefined;
    const url = attrs.href?.trim();
    if (!isHttpIri(url)) {
      result.skipped++;
      return;
    }
    const tags = [
      ...new Set([
        ...folders.filter((tag): tag is string => Boolean(tag)),
        ...(attrs.tags ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ]),
    ].sort();
    const seconds =
      attrs.add_date && /^\d+$/.test(attrs.add_date) ? Number(attrs.add_date) : Number.NaN;
    const created = new Date(seconds * 1000);
    previous = {
      url,
      title: text.trim() || new URL(url).host,
      tags,
      ...(Number.isNaN(created.getTime()) ? {} : { created }),
      ...(attrs.description ? { description: attrs.description } : {}),
      ...(attrs.notes ? { notes: attrs.notes } : {}),
      archived: attrs.archived === "1",
    };
    result.bookmarks.push(previous);
  };
  for (const token of parseTokens(html)) {
    if (token.text !== undefined) {
      if (capture) capture.text += token.text;
      continue;
    }
    if (["a", "h3", "dd", "dl", "dt"].includes(token.name) && !token.end) finish();
    if (token.end && token.name === capture?.name) finish();
    if (!token.end && ["a", "h3", "dd"].includes(token.name))
      capture = { name: token.name, text: "", attrs: token.attrs ?? {} };
    if (token.name === "br" && !token.end && capture) capture.text += "\n";
    if (token.name === "dl") {
      if (token.end) {
        finish();
        folders.pop();
      } else {
        if (folders.length >= 128) throw new RangeError("Bookmark folders are nested too deeply");
        folders.push(folder);
        folder = undefined;
      }
    }
  }
  finish();
  return result;
}

/** A portable flat export; TAGS preserves folder tags. Extra attributes preserve app fields. */
export function serializeNetscapeBookmarks(bookmarks: readonly BookmarkData[]): string {
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  ];
  for (const bookmark of bookmarks) {
    if (!isHttpIri(bookmark.url)) throw new TypeError("Only http(s) bookmarks can be exported");
    const attrs: Record<string, string> = { HREF: bookmark.url };
    if (bookmark.created) {
      if (!Number.isFinite(bookmark.created.getTime()) || bookmark.created.getTime() < 0)
        throw new TypeError("Invalid bookmark creation date");
      attrs.ADD_DATE = String(Math.floor(bookmark.created.getTime() / 1000));
    }
    if (bookmark.tags?.length) attrs.TAGS = bookmark.tags.join(",");
    if (bookmark.description) attrs.DESCRIPTION = bookmark.description;
    if (bookmark.notes) attrs.NOTES = bookmark.notes;
    if (bookmark.archived) attrs.ARCHIVED = "1";
    lines.push(
      `    <DT><A ${Object.entries(attrs)
        .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
        .join(" ")}>${escapeHtml(bookmark.title || new URL(bookmark.url).host)}</A>`,
    );
    if (bookmark.description) lines.push(`    <DD>${escapeHtml(bookmark.description)}`);
  }
  return `${lines.join("\n")}\n</DL><p>\n`;
}
