// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/** Drive → deterministic metadata documents and owned, bounded binary copies. */
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { DEFAULT_RUN_LIMITS, RunBudgetExceededError } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { arr, optionalDate, optionalText } from "../core/safe.js";
import { SOURCE_RESPONSE_TIMEOUT_MS } from "../core/source-timeout.js";
import type { BinaryDoc, ImportContext, IntegrationAdapter } from "../core/types.js";
import { CLASSES, SCHEMA } from "../core/vocab.js";
import { binaryType, download } from "./content.js";
import {
  DRIVE_API,
  DRIVE_FIXTURES,
  type DriveChangeList,
  type DriveFile,
  type DriveFileList,
  GOOGLE_APPS,
} from "./fixtures.js";
import { DriveContentRetry, DriveMetadata, DriveRetryEntry } from "./vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "google-drive";
const FIELDS =
  "id,name,mimeType,parents,size,md5Checksum,modifiedTime,createdTime,ownedByMe,webViewLink,trashed";
/** Persisted ids of files whose content download timed out, retried by the next run. */
const RETRY = "drive/_content-retry.ttl";
const MAX_RETRY_FILES = 10_000;
/** A file is dropped from the retry list once this many downloads have timed out. */
export const MAX_RETRY_ATTEMPTS = 3;
const REPRESENTATION = /^content(?:-[a-f0-9]{24})?(?:\.(?:pdf|txt))?$/;
const EXPORTABLE = new Set(
  ["document", "spreadsheet", "presentation", "drawing"].map((type) => `${GOOGLE_APPS}${type}`),
);
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
export interface GoogleDriveOptions {
  readonly maxBytes?: number;
}

/** Reversible pathId escaping; folder membership is represented by isPartOf links. */
const root = (id: string) =>
  `drive/files/${encodeURIComponent(id).replace(/~/g, "%7E").replace(/%/g, "~")}/`;
const validId = (id: unknown): id is string => {
  if (typeof id !== "string" || !id.trim() || id === "." || id === "..") return false;
  try {
    encodeURIComponent(id);
    return true;
  } catch {
    return false;
  } // Reject lone surrogates before path/IRI construction.
};
/** The file id of a canonical `drive/files/<pathId>/` directory name, never a traversal or URL. */
const idOf = (relative: string): string | undefined => {
  if (!/^[^/]+\/$/.test(relative)) return undefined;
  let id: string;
  try {
    id = decodeURIComponent(relative.slice(0, -1).replace(/~/g, "%"));
  } catch {
    return undefined;
  }
  return validId(id) && root(id) === `drive/files/${relative}` ? id : undefined;
};
const token = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function page<T>(value: unknown, field: "files" | "changes"): T {
  if (!record(value) || !Array.isArray(value[field]))
    throw new IntegrationSyncError(ID, `Drive returned an invalid ${field} page.`);
  for (const key of field === "changes"
    ? ["nextPageToken", "newStartPageToken"]
    : ["nextPageToken"])
    if (value[key] !== undefined && !token(value[key]))
      throw new IntegrationSyncError(ID, `Drive returned an invalid ${key}.`);
  if (field === "changes" && value.nextPageToken && value.newStartPageToken)
    throw new IntegrationSyncError(ID, "Drive returned conflicting page tokens.");
  return value as T;
}

async function version(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createGoogleDriveAdapter({
  maxBytes = DEFAULT_MAX_BYTES,
}: GoogleDriveOptions = {}): IntegrationAdapter {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new TypeError("maxBytes must be a non-negative safe integer.");
  return {
    metadata: {
      id: ID,
      name: "Google Drive",
      tier: "B",
      authKind: "oauth-pkce",
      scopes: GOOGLE_SCOPES.drive,
      categories: ["documents"],
      whatYouGet:
        "Drive file metadata, owned file copies under the size cap, and Google documents as PDF and text.",
      requirements: [
        "Google OAuth verification: drive.readonly is restricted; live access needs Google's app verification and security assessment.",
        "Browser hosts inject a Web OAuth client id and token proxy URL (TOKEN_PROXY).",
        "Node hosts inject a Desktop OAuth client configuration and use loopback PKCE.",
      ],
    },
    oauth: createGoogleOAuthConfig("drive"),
    vocabMap,
    fixtures: () => DRIVE_FIXTURES,
    async import(ctx) {
      ctx.progress({ label: "Reading your Drive…", done: 0 });
      const sync = new Sync(ctx, maxBytes);
      let snapshot: Snapshot | undefined;
      let incremental = false;
      if (ctx.cursor) {
        try {
          snapshot = await sync.changes(ctx.cursor);
          incremental = true;
        } catch (error) {
          if (
            !(error instanceof IntegrationSyncError) ||
            (error.status !== 404 && error.status !== 410)
          )
            throw error;
          sync.skipped = 0;
        }
      }
      snapshot ??= await sync.full();
      for (const [id, file] of snapshot.files) {
        if (file) await sync.store(file);
        else await sync.remove(id);
      }
      // A change listing omits files that timed out earlier but have not changed since; a
      // full listing has already re-attempted every listed file.
      const retry = await sync.loadRetry();
      const carried = new Set<string>();
      if (incremental) {
        const pending = [...retry.ids.keys()].filter((id) => !snapshot.files.has(id));
        // The snapshot is already committed: retries are best-effort. Running out of time or
        // budget carries the remaining entries forward, and any other per-file failure counts
        // an attempt; either way the run saves the list and returns its cursor. Only the
        // caller's cancellation fails the run here.
        const maxDurationMs = ctx.limits?.maxDurationMs ?? DEFAULT_RUN_LIMITS.maxDurationMs;
        const reserve = Math.min(SOURCE_RESPONSE_TIMEOUT_MS, maxDurationMs / 2);
        let stopped = false;
        for (const id of pending) {
          if (!stopped && ctx.budget.remainingMs <= reserve) stopped = true;
          if (!stopped)
            try {
              await sync.retryContent(id);
              continue;
            } catch (error) {
              // The run signal also carries the deadline, whose reason is a budget error.
              if (ctx.signal?.aborted && !(ctx.signal.reason instanceof RunBudgetExceededError))
                throw ctx.signal.reason;
              if (!(error instanceof RunBudgetExceededError)) {
                sync.retryFailed(id);
                continue;
              }
              stopped = true;
            }
          carried.add(id);
        }
      }
      await sync.saveRetry(retry, carried);
      ctx.progress({ label: "Done", done: snapshot.files.size, total: snapshot.files.size });
      return { cursor: snapshot.cursor, skipped: sync.skipped || undefined };
    },
  };
}
export const googleDriveAdapter = createGoogleDriveAdapter();

interface Snapshot {
  cursor: string;
  files: Map<string, DriveFile | undefined>;
}
class Sync {
  skipped = 0;
  /** Files whose content timed out, or whose retry failed, in this run. */
  private readonly unfinished = new Set<string>();
  private readonly api: typeof fetch;
  constructor(
    private readonly ctx: ImportContext,
    private readonly maxBytes: number,
  ) {
    this.api = ctx.api;
  }

  private json(url: string): Promise<unknown> {
    return getJson(ID, this.api, url);
  }

  async full(): Promise<Snapshot> {
    // Capture before listing so mutations during pagination are replayed next time.
    const start = await this.json(`${DRIVE_API}/changes/startPageToken`);
    const cursor = record(start) ? token(start.startPageToken) : undefined;
    if (!cursor) throw new IntegrationSyncError(ID, "Drive omitted its start page token.");
    const files: Snapshot["files"] = new Map();
    let pageToken: string | undefined;
    const seen = new Set<string>();
    do {
      const params = new URLSearchParams({
        q: "trashed = false",
        fields: `nextPageToken,files(${FIELDS})`,
        pageSize: "1000",
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const listing = page<DriveFileList>(await this.json(`${DRIVE_API}/files?${params}`), "files");
      this.ctx.budget.items(listing.files.length);
      for (const file of listing.files) {
        if (!validId(file?.id)) {
          this.skipped++;
          continue;
        }
        files.set(file.id, file.trashed === true ? undefined : file);
      }
      pageToken = this.next(listing.nextPageToken, seen);
    } while (pageToken);
    if (this.skipped === 0) await this.reconcile(files);
    return { cursor, files };
  }

  /** Expired change logs must also remove files absent from the new full snapshot. */
  private async reconcile(files: Snapshot["files"]): Promise<void> {
    const slug = "drive/files/";
    const listing = await this.ctx.read(slug);
    if (!listing) return;
    const base = this.ctx.resolve(slug);
    for (const child of new Container(base, listing, DataFactory).contains) {
      if (!child.value.startsWith(base)) continue;
      const relative = child.value.slice(base.length);
      const id = idOf(relative);
      if (id === undefined || files.has(id)) continue;
      const metaSlug = `${root(id)}meta.ttl`;
      const existing = await this.ctx.read(metaSlug);
      if (!existing) continue;
      const item = new DriveMetadata(`${this.ctx.resolve(metaSlug)}#it`, existing, DataFactory);
      if (item.identifier === id) files.set(id, undefined);
    }
  }

  /** Valid entries only: foreign, non-canonical or excess entries are dropped, never fatal. */
  async loadRetry(): Promise<{ ids: Map<string, number>; stored: boolean; clean: boolean }> {
    const stored = await this.ctx.read(RETRY);
    const ids = new Map<string, number>();
    if (!stored) return { ids, stored: false, clean: true };
    let listed = 0;
    const base = this.ctx.resolve("drive/files/");
    const suffix = "meta.ttl#it";
    const entries: [string, number][] = [];
    for (const iri of new DriveContentRetry(`${this.ctx.resolve(RETRY)}#it`, stored, DataFactory)
      .files) {
      listed++;
      if (!iri.startsWith(base) || !iri.endsWith(suffix)) continue;
      const id = idOf(iri.slice(base.length, -suffix.length));
      if (id === undefined || `${this.ctx.resolve(`${root(id)}meta.ttl`)}#it` !== iri) continue;
      let attempts: number | undefined;
      try {
        attempts = new DriveRetryEntry(iri, stored, DataFactory).attempts ?? 1;
      } catch {
        continue; // A count that is not a numeric literal (the first of several is used).
      }
      if (Number.isInteger(attempts) && attempts >= 1 && attempts < MAX_RETRY_ATTEMPTS)
        entries.push([id, attempts]);
    }
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [id, attempts] of entries.slice(0, MAX_RETRY_FILES)) ids.set(id, attempts);
    return { ids, stored: true, clean: ids.size === listed };
  }

  /** A retry failed for another per-file reason: counted as an attempt and as skipped. */
  retryFailed(id: string): void {
    this.unfinished.add(id);
    this.skipped++;
  }

  /** Re-reads one previously timed-out file's metadata and stores it, downloading again. */
  async retryContent(id: string): Promise<void> {
    let file: unknown;
    try {
      file = await this.json(
        `${DRIVE_API}/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: FIELDS })}`,
      );
    } catch (error) {
      // Gone since the change listing: its removal arrives with the next change page.
      if (error instanceof IntegrationSyncError && error.status === 404) return;
      throw error;
    }
    this.ctx.budget.items(1);
    if (!record(file) || file.id !== id) {
      this.skipped++;
      return;
    }
    if (file.trashed === true) await this.remove(id);
    else await this.store(file as unknown as DriveFile);
  }

  /**
   * Replaces the list with this run's timeouts and failed retries (counting attempts) plus
   * `carried` entries the run did not reach. A file is dropped after MAX_RETRY_ATTEMPTS
   * attempts or a success.
   */
  async saveRetry(
    previous: { ids: ReadonlyMap<string, number>; stored: boolean; clean: boolean },
    carried: ReadonlySet<string>,
  ): Promise<void> {
    const next = new Map<string, number>();
    for (const id of carried) next.set(id, previous.ids.get(id) ?? 1);
    for (const id of this.unfinished) {
      const attempts = (previous.ids.get(id) ?? 0) + 1;
      if (attempts < MAX_RETRY_ATTEMPTS) next.set(id, attempts);
    }
    // A list with dropped (invalid or excess) entries is rewritten even if nothing changed.
    if (
      previous.clean &&
      next.size === previous.ids.size &&
      [...next].every(([id, attempts]) => previous.ids.get(id) === attempts)
    )
      return;
    if (next.size === 0) {
      if (previous.stored) await this.ctx.remove(RETRY);
      return;
    }
    const dataset = new Store();
    const list = new DriveContentRetry(`${this.ctx.resolve(RETRY)}#it`, dataset, DataFactory);
    list.types.add(CLASSES.Dataset);
    for (const [id, attempts] of [...next]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, MAX_RETRY_FILES)) {
      const iri = `${this.ctx.resolve(`${root(id)}meta.ttl`)}#it`;
      list.files.add(iri);
      new DriveRetryEntry(iri, dataset, DataFactory).attempts = attempts;
    }
    await this.ctx.write({
      slug: RETRY,
      category: "documents",
      forClass: CLASSES.Dataset,
      dataset,
      skipRegistration: true,
    });
  }

  async changes(start: string): Promise<Snapshot> {
    const files: Snapshot["files"] = new Map();
    const seen = new Set([start]);
    let pageToken = start;
    for (;;) {
      const params = new URLSearchParams({
        pageToken,
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))`,
        pageSize: "1000",
        spaces: "drive",
      });
      const listing = page<DriveChangeList>(
        await this.json(`${DRIVE_API}/changes?${params}`),
        "changes",
      );
      this.ctx.budget.items(listing.changes.length);
      for (const change of listing.changes) {
        if (!validId(change?.fileId)) {
          this.skipped++;
          continue;
        }
        if (change.removed === true || change.file?.trashed === true)
          files.set(change.fileId, undefined);
        else if (change.file?.id === change.fileId) files.set(change.fileId, change.file);
        else this.skipped++;
      }
      const next = this.next(listing.nextPageToken, seen);
      if (next) {
        pageToken = next;
        continue;
      }
      const cursor = token(listing.newStartPageToken);
      if (!cursor) throw new IntegrationSyncError(ID, "Drive omitted its new start page token.");
      return { cursor, files };
    }
  }

  private next(value: unknown, seen: Set<string>): string | undefined {
    const next = token(value);
    if (next && seen.has(next)) throw new IntegrationSyncError(ID, "Drive repeated a page token.");
    if (next) seen.add(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    const path = root(id);
    const slug = `${path}meta.ttl`;
    const dataset = await this.ctx.read(slug);
    if (dataset) {
      const item = new DriveMetadata(`${this.ctx.resolve(slug)}#it`, dataset, DataFactory);
      // Publish the incomplete state before deleting any linked representations.
      // Retain source id and provenance for replay/full reconciliation.
      item.encodings.clear();
      item.contentSkipped = "pending-deletion";
      await this.ctx.write({
        slug,
        category: "documents",
        forClass: CLASSES.DigitalDocument,
        dataset,
        skipRegistration: true,
      });
    }
    await this.clean(path, new Set());
    // The pending-deletion write changed the ETag and cleared the retained read.
    await this.ctx.read(slug);
    await this.ctx.remove(slug);
  }

  async store(file: DriveFile): Promise<void> {
    const path = root(file.id);
    const slug = `${path}meta.ttl`;
    const iri = `${this.ctx.resolve(slug)}#it`;
    const previous = await this.ctx.read(slug);
    const old = new DriveMetadata(iri, previous ?? new Store(), DataFactory);
    const dataset = new Store();
    const item = new DriveMetadata(iri, dataset, DataFactory);
    const mimeType = optionalText(file.mimeType);
    const folder = mimeType === `${GOOGLE_APPS}folder`;
    item.types.add(folder ? `${SCHEMA}Collection` : CLASSES.DigitalDocument);
    item.identifier = file.id;
    item.name = optionalText(file.name);
    item.sourceUrl = typeof file.webViewLink === "string" ? file.webViewLink : undefined;
    item.encodingFormat = mimeType;
    item.contentSize =
      typeof file.size === "string" && /^\d+$/.test(file.size) ? file.size : undefined;
    item.checksum = optionalText(file.md5Checksum);
    item.dateCreated = optionalDate(file.createdTime);
    item.dateModified = optionalDate(file.modifiedTime);
    for (const id of arr(file.parents))
      if (validId(id)) item.parents.add(`${this.ctx.resolve(`${root(id)}meta.ttl`)}#it`);
    const content = folder ? [] : await this.content(file, item, old, path, mimeType);
    if (item.contentSkipped === "timeout") this.unfinished.add(file.id);
    else this.unfinished.delete(file.id);
    const staged: string[] = [];
    try {
      for (const doc of content) {
        // Include an attempted PUT: the server may store it before the transport fails.
        staged.push(doc.slug);
        await this.ctx.writeBinary(doc);
      }
      await this.ctx.write({
        slug,
        category: "documents",
        forClass: CLASSES.DigitalDocument,
        dataset,
        registrationContainer: "drive/",
      });
    } catch (error) {
      // Never roll back a representation linked by the winning metadata, even if
      // two imports selected the same source version or the PUT response was lost.
      try {
        const current = await this.ctx.read(slug);
        const keep = new DriveMetadata(iri, current ?? new Store(), DataFactory).encodings;
        for (const name of staged)
          if (!keep.has(this.ctx.resolve(name))) {
            try {
              await this.ctx.remove(name);
            } catch {
              /* A later successful store reconciles abandoned representations. */
            }
          }
      } catch {
        /* Preserve the original failure if current metadata cannot be read. */
      }
      throw error;
    }
    await this.clean(path, item.encodings);
  }

  private async clean(path: string, keep: ReadonlySet<string>): Promise<void> {
    const listing = await this.ctx.read(path);
    if (!listing) return;
    const base = this.ctx.resolve(path);
    for (const child of new Container(base, listing, DataFactory).contains) {
      if (!child.value.startsWith(base)) continue;
      const name = child.value.slice(base.length);
      // Only our direct, canonical representation names are eligible for deletion.
      if (REPRESENTATION.exec(name)?.[0] === name && !keep.has(child.value))
        await this.ctx.remove(`${path}${name}`);
    }
  }

  private async content(
    file: DriveFile,
    item: DriveMetadata,
    old: DriveMetadata,
    path: string,
    mimeType: string | undefined,
  ): Promise<BinaryDoc[]> {
    const exporting = EXPORTABLE.has(mimeType ?? "");
    const size =
      typeof file.size === "string" && /^\d+$/.test(file.size) ? Number(file.size) : undefined;
    let reason: string | undefined;
    if (file.ownedByMe !== true) reason = "not-owned";
    else if (!mimeType) reason = "missing-mime-type";
    else if (mimeType.startsWith(GOOGLE_APPS) && !exporting)
      reason = "unsupported-google-apps-type";
    else if (size !== undefined && (!Number.isSafeInteger(size) || size > this.maxBytes))
      reason = "size-cap-exceeded";
    else if (!exporting && size === undefined) reason = "unknown-size";
    const sourceVersion = optionalText(file.md5Checksum) ?? optionalText(file.modifiedTime);
    let revision = sourceVersion === undefined ? undefined : await version(sourceVersion);
    const extensions = exporting
      ? mimeType === `${GOOGLE_APPS}document`
        ? [".pdf", ".txt"]
        : [".pdf"]
      : [""];
    const names = () => extensions.map((extension) => `content-${revision}${extension}`);
    const sameVersion =
      (item.checksum !== undefined || item.dateModified !== undefined) &&
      item.checksum === old.checksum &&
      item.dateModified?.getTime() === old.dateModified?.getTime();
    const unchanged =
      sameVersion &&
      old.encodingFormat === mimeType &&
      // Pending deletion and missing expected links must restore content on return.
      !old.contentSkipped &&
      names().every((name) => old.encodings.has(this.ctx.resolve(`${path}${name}`)));
    const content: BinaryDoc[] = [];
    if (!reason && !unchanged) {
      for (const extension of extensions) {
        const type = exporting
          ? extension === ".pdf"
            ? "application/pdf"
            : "text/plain"
          : binaryType(mimeType as string);
        const url = `${DRIVE_API}/files/${encodeURIComponent(file.id)}${exporting ? `/export?${new URLSearchParams({ mimeType: type })}` : "?alt=media"}`;
        const result = await download(
          this.api,
          url,
          exporting ? Math.min(this.maxBytes, 10 * 1024 * 1024) : this.maxBytes,
          exporting,
        );
        if ("reason" in result) {
          reason = result.reason;
          break;
        }
        // Without source version fields, the first representation identifies the copy.
        revision ??= await version(result.body);
        content.push({
          slug: `${path}content-${revision}${extension}`,
          contentType: type,
          body: result.body,
          mode: "create",
        });
      }
    }
    item.contentSkipped = reason;
    if (!reason) for (const name of names()) item.encodings.add(this.ctx.resolve(`${path}${name}`));
    return reason ? [] : content;
  }
}
