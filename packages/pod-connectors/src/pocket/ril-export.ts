// AUTHORED-BY Claude Opus 5.5
/**
 * A bounded streaming reader for Pocket's legacy `ril_export.html`:
 *
 *   <h1>Unread</h1>
 *   <ul><li><a href="https://…" time_added="1600000000" tags="a,b">Title</a></li></ul>
 *   <h1>Read Archive</h1>
 *   <ul>…</ul>
 *
 * It is not an HTML parser. It tokenises tags and text with the shared byte-bounded
 * units (64 KiB per tag, 1 MiB per text run), skips comments, and yields one item per
 * `<a>` with the section heading that precedes it. No entity beyond the XML five and
 * numeric references is expanded, nothing is fetched, and no script or style runs.
 */
import { BoundedUnit, MAX_XML_TAG_BYTES, MAX_XML_TEXT_BYTES } from "../core/file-stream.js";
import { decodeXmlEntities, parseAttrs } from "../core/mini-xml.js";

export interface PocketItem {
  readonly url?: string;
  readonly title?: string;
  readonly timeAdded?: string;
  readonly tags?: string;
  /** True under "Read Archive", false under "Unread", undefined before any heading. */
  readonly archived?: boolean;
}

type Token = { kind: "tag"; raw: string } | { kind: "text"; raw: string | undefined };

/** Tags and text runs; an oversized text run is reported with `raw: undefined`. */
async function* htmlTokens(
  chunks: AsyncIterable<string>,
  onSkip: () => void,
): AsyncGenerator<Token> {
  const tag = new BoundedUnit(MAX_XML_TAG_BYTES);
  const text = new BoundedUnit(MAX_XML_TEXT_BYTES);
  let mode: "text" | "tag" | "comment" = "text";
  let quote = "";
  let dashes = 0;
  for await (const chunk of chunks) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i] as string;
      if (mode === "comment") {
        if (char === "-") dashes = Math.min(2, dashes + 1);
        else {
          if (char === ">" && dashes === 2) {
            mode = "text";
            start = i + 1;
          }
          dashes = 0;
        }
        continue;
      }
      if (mode === "text") {
        if (char !== "<") continue;
        text.push(chunk, start, i);
        if (text.chars > 0 || text.oversized)
          yield { kind: "text", raw: text.oversized ? undefined : text.text() };
        text.reset();
        mode = "tag";
        quote = "";
        start = i;
        continue;
      }
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") {
        tag.push(chunk, start, i + 1);
        if (tag.oversized) onSkip();
        else yield { kind: "tag", raw: tag.text() };
        tag.reset();
        mode = "text";
        start = i + 1;
        continue;
      }
      // `<!--` opens a comment; recognise it from the tag's first four characters.
      if (!tag.oversized && tag.chars + (i + 1 - start) === 4) {
        tag.push(chunk, start, i + 1);
        start = i + 1;
        if (tag.text() === "<!--") {
          tag.reset();
          mode = "comment";
          dashes = 0;
        }
      }
    }
    if (mode === "tag") tag.push(chunk, start, chunk.length);
    else if (mode === "text") text.push(chunk, start, chunk.length);
  }
  if (mode === "tag") throw new Error("Unterminated HTML tag in Pocket export.");
  if (text.oversized) onSkip();
}

function tagName(raw: string): { name: string; closing: boolean; rest: string } | undefined {
  const match = raw.match(/^<(\/?)([A-Za-z][A-Za-z0-9]*)/);
  if (!match) return undefined;
  return {
    name: (match[2] as string).toLowerCase(),
    closing: match[1] === "/",
    rest: raw.slice(match[0].length, -1),
  };
}

/** Own attributes only, with lower-cased names (no prototype lookups). */
function attributes(rest: string): Map<string, string> {
  return new Map(
    Object.entries(parseAttrs(rest)).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

/** Yield one item per `<a>`; an anchor whose text overflows the text bound is skipped. */
export async function* pocketHtmlItems(
  chunks: AsyncIterable<string>,
  onSkip: () => void,
): AsyncGenerator<PocketItem> {
  let archived: boolean | undefined;
  let heading: string | undefined;
  let anchor:
    | { attrs: Map<string, string>; text: string[]; chars: number; oversized: boolean }
    | undefined;
  const finish = (): PocketItem | undefined => {
    const current = anchor;
    anchor = undefined;
    if (!current) return undefined;
    if (current.oversized) {
      onSkip();
      return undefined;
    }
    return {
      url: current.attrs.get("href"),
      title: decodeXmlEntities(current.text.join("")),
      timeAdded: current.attrs.get("time_added"),
      tags: current.attrs.get("tags"),
      archived,
    };
  };
  for await (const token of htmlTokens(chunks, onSkip)) {
    if (token.kind === "text") {
      if (anchor) {
        // Text split by inline markup shares one bound per anchor.
        anchor.chars += token.raw?.length ?? Number.POSITIVE_INFINITY;
        if (anchor.chars > MAX_XML_TEXT_BYTES) {
          anchor.oversized = true;
          anchor.text = [];
        } else if (token.raw !== undefined) anchor.text.push(token.raw);
      } else if (heading !== undefined && token.raw !== undefined && heading.length < 256)
        heading = (heading + token.raw).slice(0, 256);
      continue;
    }
    const tag = tagName(token.raw);
    if (!tag) continue;
    if (tag.name === "a") {
      const previous = finish();
      if (previous) yield previous;
      if (!tag.closing)
        anchor = { attrs: attributes(tag.rest), text: [], chars: 0, oversized: false };
    } else if (tag.name === "h1") {
      if (!tag.closing) heading = "";
      else if (heading !== undefined) {
        const label = decodeXmlEntities(heading).toLowerCase();
        if (label.includes("archive")) archived = true;
        else if (label.includes("unread")) archived = false;
        heading = undefined;
      }
    }
  }
  const last = finish();
  if (last) yield last;
}
