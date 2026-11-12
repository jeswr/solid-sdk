// AUTHORED-BY Claude Opus 5.5
/**
 * Pocket → Documents (Tier-C file import).
 *
 * Pocket's export came in two shapes, both accepted (the content, not the name, decides):
 *
 *   CSV (2024–2025):  `title,url,time_added,tags,status` — Unix seconds, `|`-separated
 *                     tags, status `unread` or `archive`.
 *   ril_export.html:  `<a href time_added tags>` anchors under "Unread" / "Read Archive".
 *
 * Each saved link becomes a `book:Bookmark` in the `@jeswr/solid-bookmark` wire format
 * (see {@link Bookmark}): the saved URL, title, added time, archived flag and tags. Only
 * credential-free absolute http(s) URLs are kept; `javascript:`, `data:` and every other
 * scheme are skipped and counted. A link saved twice is one bookmark (its tags merge).
 * Pocket closed in 2025, so there is no live export page: users import a file they
 * downloaded earlier.
 */
import { DataFactory, Store } from "n3";
import {
  cappedText,
  httpUrl,
  MAX_TITLE_CHARS,
  tagList,
  unixSecondsDate,
} from "../core/export-fields.js";
import type { FileImportAdapter, FileImportContext, ImportFile } from "../core/file-import.js";
import { csvRowsFromChunks, fileText } from "../core/file-stream.js";
import { recordFragment } from "../core/slug.js";
import type { IntegrationMetadata } from "../core/types.js";
import { Bookmark, CLASSES } from "../core/vocab.js";
import { type PocketItem, pocketHtmlItems } from "./ril-export.js";
import { vocabMap } from "./vocab-map.js";

const ID = "pocket";
const SLUG = "documents/pocket-bookmarks.ttl";

/** Leading whitespace scanned before deciding between HTML and CSV. */
const SNIFF_CHARS = 64 * 1024;

const metadata: IntegrationMetadata = {
  id: ID,
  name: "Pocket",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["documents"],
  whatYouGet: "Your saved links, tags and archive, saved as bookmarks in Documents.",
  requirements: [],
};

export const pocketFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".csv,text/csv,.html,text/html",
  fileHint:
    "Select the Pocket export you downloaded before Pocket closed: the CSV from the export ZIP (unzip it first) or the older ril_export.html.",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void> {
    ctx.progress({ label: "Reading your saved links…", done: 0, total: 1 });
    const doc = ctx.resolve(SLUG);
    const store = new Store();
    const seen = new Set<string>();
    let rows = 0;
    const { html, chunks } = await sniffMarkup(fileText(file));
    const items = html ? pocketHtmlItems(chunks, ctx.skip) : pocketCsvItems(chunks, ctx.skip);
    for await (const item of items) {
      if (rows >= ctx.maxRows) break;
      rows++;
      const url = httpUrl(item.url);
      if (!url) {
        ctx.skip();
        continue;
      }
      const bookmark = new Bookmark(
        `${doc}#bookmark-${recordFragment(url.replace(/^https?:\/\//, ""), url)}`,
        store,
        DataFactory,
      ).mark();
      const tags = tagList(item.tags, html ? "," : "|");
      if (seen.has(url)) {
        // The first occurrence keeps its fields; a duplicate only contributes tags.
        for (const tag of tags) bookmark.tags.add(tag);
        continue;
      }
      seen.add(url);
      bookmark.url = url;
      bookmark.title = cappedText(item.title?.replace(/\s+/g, " "), MAX_TITLE_CHARS);
      bookmark.created = unixSecondsDate(item.timeAdded?.trim());
      bookmark.archived = item.archived;
      for (const tag of tags) bookmark.tags.add(tag);
    }

    ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
    if (store.size === 0) return;
    await ctx.write({
      slug: SLUG,
      category: "documents",
      forClass: CLASSES.Bookmark,
      dataset: store,
    });
  },
};

/** CSV rows as items; `status` is `archive` or `unread` (anything else leaves it unset). */
async function* pocketCsvItems(
  chunks: AsyncIterable<string>,
  onSkip: () => void,
): AsyncGenerator<PocketItem> {
  for await (const row of csvRowsFromChunks(chunks, onSkip)) {
    const status = row.status?.trim().toLowerCase();
    yield {
      url: row.url,
      title: row.title,
      timeAdded: row.time_added,
      tags: row.tags,
      archived: status === "archive" ? true : status === "unread" ? false : undefined,
    };
  }
}

/**
 * Decide between the HTML and CSV readers from the first non-whitespace character,
 * then replay the inspected chunks. The source is closed however the caller stops.
 */
export async function sniffMarkup(
  source: AsyncGenerator<string>,
): Promise<{ html: boolean; chunks: AsyncGenerator<string> }> {
  const buffered: string[] = [];
  let scanned = 0;
  let first: string | undefined;
  try {
    while (first === undefined && scanned < SNIFF_CHARS) {
      const next = await source.next();
      if (next.done) break;
      buffered.push(next.value);
      const content = next.value.replace(/^[\s﻿]+/, "");
      if (content) first = content[0];
      scanned += next.value.length;
    }
  } catch (error) {
    await source.return(undefined);
    throw error;
  }
  async function* replay(): AsyncGenerator<string> {
    try {
      yield* buffered.splice(0);
      yield* source;
    } finally {
      await source.return(undefined);
    }
  }
  return { html: first === "<", chunks: replay() };
}
