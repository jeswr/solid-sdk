// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Google Takeout archives and legacy single MyActivity JSON exports. */
import { DataFactory, Store } from "n3";
import type {
  FileImportAdapter,
  FileImportContext,
  FileImportOutcome,
  ImportFile,
} from "../core/file-import.js";
import { recordFragment } from "../core/slug.js";
import type { IntegrationMetadata, NormalisedDoc } from "../core/types.js";
import { CalendarEvent, CLASSES, TextDocument, WatchAction } from "../core/vocab.js";
import { importArchive, mailboxAccount, sniffInput } from "./dispatch.js";
import { vocabMap } from "./vocab-map.js";
import { InflationBudget, zipDirectory } from "./zip-reader.js";

const ID = "google-takeout";

const metadata: IntegrationMetadata = {
  id: ID,
  name: "Google Takeout",
  tier: "C",
  authKind: "export-file",
  scopes: [],
  categories: ["documents", "media", "calendar", "contacts", "mail", "mobility", "health"],
  whatYouGet:
    "Mail, calendar, contacts, Drive files, activity history, location visits and Fit daily metrics from supported Takeout exports; unsupported products are reported.",
  requirements: [],
};

export interface Activity {
  readonly header: string;
  readonly title: string;
  readonly url?: string;
  readonly time?: Date;
}

export const googleTakeoutFileAdapter: FileImportAdapter = {
  vocabMap,
  metadata,
  accept: ".zip,application/zip,.json,application/json",
  streaming: true,
  fileHint:
    "Request your archive at takeout.google.com and select the downloaded .zip; no need to unzip. Legacy MyActivity.json is also supported.",
  exportUrl: "https://takeout.google.com",

  async importFile(file: ImportFile, ctx: FileImportContext): Promise<void | FileImportOutcome> {
    const input = await sniffInput(file);
    if (input.zip) {
      const entries = await zipDirectory(file);
      const inflationBudget = new InflationBudget();
      const account = await mailboxAccount(file, entries, inflationBudget);
      return importArchive(file, ctx, account, entries, { inflationBudget });
    }
    await writeActivities(input.text, ctx);
  },
};

/** Shared legacy/archive mapping; each archive entry has its own deterministic snapshot. */
export async function writeActivities(
  text: string,
  ctx: FileImportContext,
  suffix = "",
  snapshot?: (doc: NormalisedDoc) => Promise<void>,
): Promise<void> {
  const activities = parseMyActivity(text, ctx.maxRows);
  let complete = false;
  if (!snapshot) {
    try {
      const rows: unknown = JSON.parse(text);
      complete = Array.isArray(rows) && rows.length === activities.length;
    } catch {
      /* Invalid legacy input cannot clear earlier records. */
    }
  }
  const save =
    snapshot ??
    (async (doc: NormalisedDoc) => {
      if (doc.dataset.size) await ctx.write({ ...doc, writeMode: complete ? "replace" : "merge" });
      else if (complete && (await ctx.read(doc.slug))) await ctx.remove(doc.slug);
    });
  const docsDoc = ctx.resolve(`documents/google-activity${suffix}.ttl`);
  const mediaDoc = ctx.resolve(`media/youtube-activity${suffix}.ttl`);
  const calDoc = ctx.resolve(`calendar/google-calendar-activity${suffix}.ttl`);
  const docs = new Store();
  const media = new Store();
  const cal = new Store();

  for (const a of activities) {
    const key = `${a.header}|${a.title}|${a.time?.toISOString() ?? ""}`;
    const frag = recordFragment(a.title, key);
    const product = a.header.toLowerCase();
    if (product.includes("youtube")) {
      const w = new WatchAction(`${mediaDoc}#watch-${frag}`, media, DataFactory).mark();
      w.name = a.title;
      if (a.time) w.startTime = a.time;
      if (a.url) w.sourceUrl = a.url;
    } else if (product.includes("calendar")) {
      const ev = new CalendarEvent(`${calDoc}#event-${frag}`, cal, DataFactory).mark();
      ev.name = a.title;
      if (a.time) ev.startDate = a.time;
    } else {
      const td = new TextDocument(`${docsDoc}#activity-${frag}`, docs, DataFactory).mark();
      td.name = a.title;
      td.description = a.header;
      if (a.url) td.sourceUrl = a.url;
      if (a.time) td.dateCreated = a.time;
    }
  }

  ctx.progress({ label: "Saving to your pod…", done: 1, total: 1 });
  if (docs.size > 0 || snapshot || complete) {
    await save({
      slug: `documents/google-activity${suffix}.ttl`,
      category: "documents",
      forClass: CLASSES.TextDigitalDocument,
      dataset: docs,
    });
  }
  if (media.size > 0 || snapshot || complete) {
    await save({
      slug: `media/youtube-activity${suffix}.ttl`,
      category: "media",
      forClass: CLASSES.WatchAction,
      dataset: media,
    });
  }
  if (cal.size > 0 || snapshot || complete) {
    await save({
      slug: `calendar/google-calendar-activity${suffix}.ttl`,
      category: "calendar",
      forClass: CLASSES.Event,
      dataset: cal,
    });
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Parse `MyActivity.json` into activity records (bounded by `limit`). */
export function parseMyActivity(text: string, limit = Number.POSITIVE_INFINITY): Activity[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Activity[] = [];
  for (const raw of data) {
    if (out.length >= limit) break;
    if (!isObject(raw)) continue;
    const title = asString(raw.title)?.trim();
    if (!title) continue;
    const header = asString(raw.header)?.trim() ?? firstProduct(raw.products) ?? "Google";
    out.push({
      header,
      title,
      url: safeHttpUrl(asString(raw.titleUrl)),
      time: parseIsoTime(asString(raw.time)),
    });
  }
  return out;
}

function firstProduct(products: unknown): string | undefined {
  return Array.isArray(products) && typeof products[0] === "string" ? products[0] : undefined;
}

/** Only keep http(s) URLs as a literal — never anything we'd be tempted to fetch. */
function safeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseIsoTime(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
