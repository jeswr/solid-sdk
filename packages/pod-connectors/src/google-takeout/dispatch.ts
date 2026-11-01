// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import type { FileImportContext, FileImportOutcome, ImportFile } from "../core/file-import.js";
import type { NormalisedDoc } from "../core/types.js";
import { CLASSES } from "../core/vocab.js";
import { calendarEvents } from "../google-calendar/adapter.js";
import { members, writeContactIndex } from "../google-contacts/adapter.js";
import { personDocument } from "../google-contacts/mapping.js";
import { DEFAULT_MAX_BYTES } from "../google-drive/adapter.js";
import { binaryType } from "../google-drive/content.js";
import { DriveMetadata } from "../google-drive/vocab.js";
import { pathId } from "../mail/paths.js";
import {
  createMailWriter,
  type MailFolder,
  MailParseError,
  type MailWriter,
} from "../mail/writer.js";
import { parseMyActivity, writeActivities } from "./file-adapter.js";
import { mailHeaders, mailLabels, mboxSink, sha256 } from "./mbox.js";
import { fitDocument, locationDocument } from "./products.js";
import { readIcs, readVcards } from "./readers.js";
import {
  cappedSink,
  type EntrySink,
  type InflationBudget,
  MAX_ENTRY_BYTES,
  readZip,
  readZipEntry,
  TotalInflatedLimit,
  ZIP_PIECE_BYTES,
  ZipDecoderError,
  type ZipEntry,
  zipDirectory,
} from "./zip-reader.js";

/** Entry names are display/dispatch input only. Escape every segment used in a slug. */
export function entryPath(name: string): string | undefined {
  if (
    !name.startsWith("Takeout/") ||
    name.includes("\\") ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32)
  )
    return undefined;
  const path = name.slice(8);
  const parts = path.split("/");
  if (parts.length > 16 || parts.some((p) => !p.trim() || p === "." || p === ".."))
    return undefined;
  try {
    parts.map(pathId);
  } catch {
    return undefined;
  }
  return path;
}
const escaped = (path: string) => path.split("/").map(pathId).join("/");

export type Product =
  | "mail"
  | "calendar"
  | "contacts"
  | "drive"
  | "activity"
  | "location"
  | "fit"
  | "raw-location"
  | "unsupported";
/** Content extensions precede localised product folders, except Drive's owned files. */
export function productFor(path: string): Product {
  if (path.startsWith("Drive/")) return "drive";
  if (/\.mbox$/i.test(path)) return "mail";
  if (/\.ics$/i.test(path)) return "calendar";
  if (/\.vcf$/i.test(path)) return "contacts";
  if (
    /^My Activity\/.+\/MyActivity\.json$/.test(path) ||
    path === "YouTube and YouTube Music/history/watch-history.json"
  )
    return "activity";
  if (/^Semantic Location History\/\d{4}\/\d{4}_[A-Z]+\.json$/.test(path)) return "location";
  if (/(?:^|\/)Records\.json$/.test(path)) return "raw-location";
  if (/^Fit\/Daily activity metrics\/[^/]+\.csv$/.test(path)) return "fit";
  return "unsupported";
}

async function* fileChunks(stream: () => ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream().getReader();
  let ended = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      for (let i = 0; i < value.length; i += ZIP_PIECE_BYTES)
        yield value.subarray(i, i + ZIP_PIECE_BYTES);
    }
  } finally {
    try {
      if (!ended) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

/** Sniff the signature, never the filename, before selecting the archive reader. */
export async function sniffInput(
  file: ImportFile,
): Promise<{ zip: true } | { zip: false; text: string }> {
  if (!file.stream) {
    // The legacy text-only port cannot inspect binary bytes. Refuse archive uploads
    // before calling text(); native File and the CLI supply stream().
    if (!/\.json$/i.test(file.name) && file.type !== "application/json")
      throw new Error("Takeout zip imports require file.stream().");
    if (file.size > MAX_ENTRY_BYTES) throw new Error("Takeout JSON exceeds the 64 MiB limit.");
    const text = await file.text();
    if (text.startsWith("PK\x03\x04"))
      throw new Error("Takeout zip imports require file.stream().");
    if (new TextEncoder().encode(text).length > MAX_ENTRY_BYTES)
      throw new Error("Takeout JSON exceeds the 64 MiB limit.");
    return { zip: false, text };
  }
  const iterator = fileChunks(() => (file.stream as () => ReadableStream<Uint8Array>)());
  const prefix: Uint8Array[] = [];
  let length = 0;
  while (length < 4) {
    const next = await iterator.next();
    if (next.done) break;
    prefix.push(next.value);
    length += next.value.length;
  }
  async function* rest(): AsyncGenerator<Uint8Array> {
    try {
      yield* prefix;
      yield* iterator;
    } finally {
      await iterator.return(undefined);
    }
  }
  const signature = new Uint8Array(4);
  let offset = 0;
  for (const bytes of prefix) {
    const n = Math.min(4 - offset, bytes.length);
    signature.set(bytes.subarray(0, n), offset);
    offset += n;
  }
  if (signature[0] === 80 && signature[1] === 75 && signature[2] === 3 && signature[3] === 4) {
    await iterator.return(undefined);
    if (!file.slice) throw new Error("Takeout zip imports require file.slice().");
    return { zip: true };
  }
  const decoder = new TextDecoder();
  let count = 0;
  const text: string[] = [];
  for await (const bytes of rest()) {
    count += bytes.length;
    if (count > MAX_ENTRY_BYTES) throw new Error("Takeout JSON exceeds the 64 MiB limit.");
    text.push(decoder.decode(bytes, { stream: true }));
  }
  text.push(decoder.decode());
  return { zip: false, text: text.join("") };
}

/** Only the first message's header block in the first valid mbox selects identity. */
export async function mailboxAccount(
  file: ImportFile,
  entries: ZipEntry[],
  inflationBudget?: InflationBudget,
): Promise<string> {
  const entry = entries.find((entry) => {
    const path = entryPath(entry.name);
    return !entry.invalid && path && productFor(path) === "mail";
  });
  if (!entry) return "google-takeout";
  let header = "";
  let headerBytes = 0;
  const decoder = new TextDecoder();
  const stop = new Error("header complete");
  try {
    await readZipEntry(
      file,
      entry,
      {
        async push(bytes, final) {
          const piece = bytes.subarray(0, ZIP_PIECE_BYTES - headerBytes);
          headerBytes += piece.length;
          header += decoder.decode(piece, { stream: !final });
          if (/\r?\n\r?\n/.test(header) || headerBytes >= ZIP_PIECE_BYTES || final) throw stop;
        },
      },
      { inflationBudget },
      undefined,
      64,
    );
  } catch (error) {
    if (error instanceof TotalInflatedLimit || error instanceof ZipDecoderError) throw error;
    if (error !== stop) return "google-takeout";
  }
  const address = mailHeaders(new TextEncoder().encode(header)).get("delivered-to");
  return address && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address) ? address : "google-takeout";
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  html: "text/html",
  csv: "text/csv",
  json: "application/json",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ttl: "text/turtle",
  rdf: "application/rdf+xml",
  jsonld: "application/ld+json",
};

export interface ArchiveOptions {
  inflationBudget?: InflationBudget;
  maxReconciliationSubjects?: number;
  maxReconciliationBytes?: number;
}

const MAX_RECONCILIATION_SUBJECTS = 1_000_000;
const MAX_RECONCILIATION_BYTES = 64 * 1024 * 1024;

export async function importArchive(
  file: ImportFile,
  ctx: FileImportContext,
  account = "google-takeout",
  entries?: ZipEntry[],
  options: ArchiveOptions = {},
): Promise<FileImportOutcome> {
  entries ??= await zipDirectory(file);
  let skipped = 0;
  const unsupported = new Set<string>();
  const contacts = new Map<string, string>();
  let contactCount = 0;
  let hasContacts = false;
  const incomplete = new Set<Product>();
  const snapshots = new Map<
    string,
    { doc: NormalisedDoc; product: Product; subjects: Set<string> }
  >();
  const cappedProducts = new Set<Product>();
  const retained = new Map<Product, { subjects: number; bytes: number }>();
  let retainedSubjects = 0;
  let retainedBytes = 0;
  const maxSubjects = Math.min(
    options.maxReconciliationSubjects ?? MAX_RECONCILIATION_SUBJECTS,
    MAX_RECONCILIATION_SUBJECTS,
  );
  const maxBytes = Math.min(
    options.maxReconciliationBytes ?? MAX_RECONCILIATION_BYTES,
    MAX_RECONCILIATION_BYTES,
  );
  const encoder = new TextEncoder();
  const retain = (
    product: Product,
    identifier: string,
    extraText = "",
    previousText?: string,
  ): boolean => {
    if (cappedProducts.has(product)) return false;
    const subjects = previousText === undefined ? 1 : 0;
    const bytes =
      encoder.encode(extraText).length +
      (previousText === undefined
        ? encoder.encode(identifier).length
        : -encoder.encode(previousText).length);
    if (retainedSubjects + subjects > maxSubjects || retainedBytes + bytes > maxBytes) {
      cappedProducts.add(product);
      incomplete.add(product);
      skipped++;
      unsupported.add(`${product}: reconciliation-state-cap-exceeded`);
      // This product can no longer prune; release its earlier manifests so other
      // products can still use the one shared budget and reconcile normally.
      for (const [slug, snapshot] of snapshots)
        if (snapshot.product === product) snapshots.delete(slug);
      const previous = retained.get(product);
      retainedSubjects -= previous?.subjects ?? 0;
      retainedBytes -= previous?.bytes ?? 0;
      retained.delete(product);
      return false;
    }
    const state = retained.get(product) ?? { subjects: 0, bytes: 0 };
    state.subjects += subjects;
    state.bytes += bytes;
    retained.set(product, state);
    retainedSubjects += subjects;
    retainedBytes += bytes;
    return true;
  };
  const snapshot = async (doc: NormalisedDoc, product: Product) => {
    if (!incomplete.has(product)) {
      const subjects = new Set<string>();
      for (const quad of doc.dataset) {
        const identifier = `${quad.subject.termType}:${quad.subject.value}`;
        if (subjects.has(identifier)) continue;
        if (!retain(product, identifier)) {
          subjects.clear();
          break;
        }
        subjects.add(identifier);
      }
      if (!incomplete.has(product))
        snapshots.set(doc.slug, { doc: { ...doc, dataset: new Store() }, product, subjects });
    }
    if (doc.dataset.size) await ctx.write({ ...doc, writeMode: "merge" });
  };
  const mergeContactIndex = (current: ReadonlyMap<string, string>) =>
    writeContactIndex(
      {
        resolve: ctx.resolve,
        write: (doc) => ctx.write({ ...doc, writeMode: "merge" }),
      },
      current,
    );
  let mail: MailWriter | undefined;
  let mailCount = 0;
  const folders = new Map<string, MailFolder>();
  const unsupportedEntry = (name: string, reason?: string) => {
    const path = entryPath(name);
    const product = path?.split("/")[0] ?? "(invalid path)";
    unsupported.add(reason ? `${product}: ${reason}` : product);
  };
  const addMessage = async (raw: Uint8Array) => {
    if (mailCount++ >= ctx.maxRows) {
      skipped++;
      return;
    }
    const headers = mailHeaders(raw);
    const labels = mailLabels(headers.get("x-gmail-labels") ?? "");
    if (labels.spam) {
      skipped++;
      return;
    }
    mail ??= createMailWriter(ctx, account);
    for (const folder of labels.folders) folders.set(folder.key, folder);
    const thrid = headers.get("x-gm-thrid");
    const fallbackId = `takeout-${(await sha256(raw)).slice(0, 32)}`;
    try {
      await mail.add({
        raw,
        ...labels,
        fallbackId,
        threadKey: thrid && /^\d+$/.test(thrid) ? `gmail-${BigInt(thrid).toString(16)}` : undefined,
        sourceUrl: `urn:google-takeout:mail:${encodeURIComponent(headers.get("message-id") || fallbackId)}`,
      });
    } catch (error) {
      if (!(error instanceof MailParseError)) throw error;
      skipped++;
    }
  };
  const discard: EntrySink = { push: async () => {} };
  await readZip(
    file,
    {
      inflationBudget: options.inflationBudget,
      limit(name) {
        const path = entryPath(name);
        return path && productFor(path) === "mail"
          ? Number.MAX_SAFE_INTEGER
          : path && productFor(path) === "drive"
            ? DEFAULT_MAX_BYTES
            : MAX_ENTRY_BYTES;
      },
      async skip(name, reason) {
        const path = entryPath(name);
        if (reason === "total-inflated-cap-exceeded")
          for (const product of ["contacts", "activity", "calendar", "location", "fit"] as const)
            incomplete.add(product);
        incomplete.add(productFor(path ?? name.replace(/^Takeout\//, "")));
        skipped++;
        if (path && productFor(path) === "drive" && reason === "entry-inflated-cap-exceeded") {
          const size = (entries as ZipEntry[]).find((entry) => entry.name === name)!.size;
          await drive(path, undefined, size, ctx);
        } else unsupportedEntry(name, reason);
      },
      entry(name) {
        if (
          name.endsWith("/") ||
          name === "archive_browser.html" ||
          name === "Takeout/archive_browser.html"
        )
          return discard;
        const path = entryPath(name);
        if (!path) {
          incomplete.add(productFor(name.replace(/^Takeout\//, "")));
          skipped++;
          unsupportedEntry(name, "unsafe-entry-path");
          return discard;
        }
        const product = productFor(path);
        if (product === "unsupported" || product === "raw-location") {
          unsupportedEntry(
            name,
            product === "raw-location" ? "Records.json (raw points unsupported)" : undefined,
          );
          return discard;
        }
        if (product === "mail")
          return mboxSink(addMessage, () => {
            skipped++;
          });
        const cap = product === "drive" ? DEFAULT_MAX_BYTES : MAX_ENTRY_BYTES;
        return cappedSink(cap, async (bytes, size) => {
          // readZip enforces the cap and declared size before this final callback.
          const content = bytes as Uint8Array;
          const text = product === "drive" ? "" : new TextDecoder().decode(content);
          const safe = escaped(path);
          // Parse errors are source skips. Pod writes are deliberately outside these catches.
          if (product === "drive") {
            await drive(path, content, size, ctx);
            return;
          }
          if (product === "calendar") {
            let mapped: ReturnType<typeof calendarEvents>;
            const slug = `calendar/takeout/${safe}.ttl`;
            try {
              mapped = calendarEvents(readIcs(text, ctx.maxRows), ctx.resolve(slug));
            } catch {
              incomplete.add(product);
              skipped++;
              return;
            }
            skipped += mapped.skipped;
            if (mapped.skipped) incomplete.add(product);
            await snapshot(
              {
                slug,
                category: "calendar",
                forClass: CLASSES.Event,
                dataset: mapped.dataset,
              },
              product,
            );
          } else if (product === "contacts") {
            let cards: Awaited<ReturnType<typeof readVcards>>;
            try {
              cards = await readVcards(text, ctx.maxRows);
            } catch {
              incomplete.add("contacts");
              skipped++;
              return;
            }
            hasContacts = true;
            for (const { id, person } of cards) {
              if (contactCount++ >= ctx.maxRows) {
                incomplete.add("contacts");
                skipped++;
                continue;
              }
              const { doc, fn } = personDocument(person, id, (slug) => ctx.resolve(slug));
              await ctx.write({ ...doc, sourceUrl: "urn:google-takeout:contacts" });
              if (!retain("contacts", doc.slug, fn, contacts.get(doc.slug))) {
                // Publish the bounded pending index before releasing it. Once capped,
                // merge each new member immediately rather than retaining archive state.
                if (contacts.size) {
                  await mergeContactIndex(contacts);
                  contacts.clear();
                }
                await mergeContactIndex(new Map([[doc.slug, fn]]));
              } else contacts.set(doc.slug, fn);
            }
          } else if (product === "activity") {
            let data: unknown;
            try {
              data = JSON.parse(text);
            } catch {
              incomplete.add(product);
              skipped++;
              return;
            }
            if (!Array.isArray(data)) {
              incomplete.add(product);
              skipped++;
              return;
            }
            const omitted = data.length - parseMyActivity(text, ctx.maxRows).length;
            skipped += omitted;
            if (omitted) incomplete.add(product);
            await writeActivities(
              text,
              ctx,
              `-takeout-${(await sha256(path)).slice(0, 32)}`,
              (doc) => snapshot(doc, product),
            );
          } else {
            let result: ReturnType<typeof locationDocument>;
            try {
              result =
                product === "location"
                  ? locationDocument(text, `location/takeout/${safe}.ttl`, ctx)
                  : fitDocument(text, `health/takeout/${safe}.ttl`, ctx);
            } catch {
              incomplete.add(product);
              skipped++;
              return;
            }
            skipped += result.skipped;
            if (result.skipped) incomplete.add(product);
            await snapshot(result.doc, product);
          }
        });
      },
    },
    entries,
  );
  for (const { doc, product, subjects } of snapshots.values()) {
    if (incomplete.has(product)) continue;
    const existing = await ctx.read(doc.slug);
    if (!subjects.size) {
      if (existing) await ctx.remove(doc.slug);
    } else {
      if (!existing) throw new Error("Takeout snapshot disappeared before reconciliation.");
      const dataset = new Store();
      for (const quad of existing)
        if (subjects.has(`${quad.subject.termType}:${quad.subject.value}`)) dataset.add(quad);
      await ctx.write({ ...doc, dataset });
    }
  }
  if (hasContacts && !cappedProducts.has("contacts")) {
    const existing = await ctx.read("contacts/people.ttl");
    const previous = members(ctx, existing, `${ctx.resolve("contacts/index.ttl")}#this`);
    if (incomplete.has("contacts"))
      for (const [slug, fn] of previous) if (!contacts.has(slug)) contacts.set(slug, fn);
    for (const slug of previous.keys())
      if (!contacts.has(slug)) {
        await ctx.read(slug);
        await ctx.remove(slug);
      }
    await writeContactIndex(ctx, contacts);
  }
  await mail?.flush([...folders.values()]);
  return {
    skipped: skipped || undefined,
    unsupported: unsupported.size ? [...unsupported].sort() : undefined,
  };
}

async function drive(
  path: string,
  bytes: Uint8Array | undefined,
  size: number,
  ctx: FileImportContext,
): Promise<void> {
  const relative = escaped(path.slice("Drive/".length));
  const slug = `drive/takeout/${relative}`;
  const metaSlug = `drive/takeout-meta/${relative}.ttl`;
  const dataset = new Store();
  const metadata = new DriveMetadata(`${ctx.resolve(metaSlug)}#it`, dataset, DataFactory);
  metadata.types.add(CLASSES.DigitalDocument);
  metadata.name = path.split("/").pop();
  metadata.identifier = path;
  metadata.contentSize = String(size);
  metadata.encodingFormat =
    MIME[(path.split(".").pop() as string).toLowerCase()] ?? "application/octet-stream";
  if (bytes) {
    const result = await ctx.writeBinary({
      slug,
      contentType: binaryType(metadata.encodingFormat),
      body: bytes,
      mode: "replace",
    });
    metadata.encodings.add(result.url);
  } else {
    metadata.contentSkipped = "size-cap-exceeded";
    await ctx.remove(slug);
  }
  await ctx.write({
    slug: metaSlug,
    category: "documents",
    forClass: CLASSES.DigitalDocument,
    registrationContainer: "drive/",
    dataset,
  });
}
