// AUTHORED-BY Codex GPT-6.1-Sol
/** Drive → deterministic metadata documents and owned, bounded binary copies. */
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { RunBudget, readJson } from "../core/budget.js";
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { arr, optionalDate, optionalText } from "../core/safe.js";
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
import { DriveMetadata } from "./vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "google-drive";
const FIELDS =
  "id,name,mimeType,parents,size,md5Checksum,modifiedTime,createdTime,ownedByMe,webViewLink,trashed";
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
      if (ctx.cursor) {
        try {
          snapshot = await sync.changes(ctx.cursor);
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
  private readonly budget = new RunBudget(ID);
  private readonly api: typeof fetch;
  constructor(
    private readonly ctx: ImportContext,
    private readonly maxBytes: number,
  ) {
    this.api = (input, init) => {
      this.budget.request();
      return ctx.api(input, init);
    };
  }

  private async json(url: string): Promise<unknown> {
    const res = await this.api(url);
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      throw new RateLimitedError(
        ID,
        url,
        retryAfter ? Number.parseInt(retryAfter, 10) || undefined : undefined,
      );
    }
    if (!res.ok)
      throw new IntegrationSyncError(ID, `The platform answered ${res.status} for ${url}.`, {
        url,
        status: res.status,
      });
    return readJson(res, ID, url, undefined, this.budget);
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
      this.budget.items(listing.files.length);
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
      if (!/^[^/]+\/$/.test(relative)) continue;
      let id: string;
      try {
        id = decodeURIComponent(relative.slice(0, -1).replace(/~/g, "%"));
      } catch {
        continue;
      }
      // Follow only a canonical adapter path, never a listing-supplied traversal or URL.
      if (!validId(id) || root(id) !== `${slug}${relative}` || files.has(id)) continue;
      const metaSlug = `${root(id)}meta.ttl`;
      const existing = await this.ctx.read(metaSlug);
      if (!existing) continue;
      const item = new DriveMetadata(`${this.ctx.resolve(metaSlug)}#it`, existing, DataFactory);
      if (item.identifier === id) files.set(id, undefined);
    }
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
      this.budget.items(listing.changes.length);
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
