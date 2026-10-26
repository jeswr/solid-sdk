// AUTHORED-BY Codex GPT-6.1-Sol
/** Drive → deterministic metadata documents and owned, bounded binary copies. */
import { Container } from "@solid/object";
import { DataFactory, Store } from "n3";
import { createGoogleOAuthConfig, GOOGLE_SCOPES } from "../adapters/google/oauth.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { arr, optionalDate, optionalText } from "../core/safe.js";
import type { ImportContext, IntegrationAdapter } from "../core/types.js";
import { CLASSES, SCHEMA } from "../core/vocab.js";
import { binaryType, download } from "./content.js";
import {
  DRIVE_API,
  DRIVE_FIXTURES,
  type DriveChangeList,
  type DriveFile,
  type DriveFileList,
  type DriveStartPageToken,
  GOOGLE_APPS,
} from "./fixtures.js";
import { DriveMetadata } from "./vocab.js";
import { vocabMap } from "./vocab-map.js";

const ID = "google-drive";
const FIELDS =
  "id,name,mimeType,parents,size,md5Checksum,modifiedTime,createdTime,ownedByMe,webViewLink,trashed";
const CONTENTS = ["content", "content.pdf", "content.txt"] as const;
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
  constructor(
    private readonly ctx: ImportContext,
    private readonly maxBytes: number,
  ) {}

  async full(): Promise<Snapshot> {
    // Capture before listing so mutations during pagination are replayed next time.
    const start = await getJson<DriveStartPageToken>(
      ID,
      this.ctx.api,
      `${DRIVE_API}/changes/startPageToken`,
    );
    const cursor = token(start?.startPageToken);
    if (!cursor) throw new IntegrationSyncError(ID, "Drive omitted its start page token.");
    const files: Snapshot["files"] = new Map();
    let pageToken: string | undefined;
    let complete = true;
    const seen = new Set<string>();
    do {
      const params = new URLSearchParams({
        q: "trashed = false",
        fields: `nextPageToken,files(${FIELDS})`,
        pageSize: "1000",
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await getJson<DriveFileList>(ID, this.ctx.api, `${DRIVE_API}/files?${params}`);
      complete &&= !!page && (page.files === undefined || Array.isArray(page.files));
      for (const file of arr(page?.files)) {
        if (!validId(file?.id)) {
          this.skipped++;
          continue;
        }
        files.set(file.id, file.trashed === true ? undefined : file);
      }
      pageToken = this.next(page?.nextPageToken, seen);
    } while (pageToken);
    if (complete && this.skipped === 0) await this.reconcile(files);
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
      const page = await getJson<DriveChangeList>(
        ID,
        this.ctx.api,
        `${DRIVE_API}/changes?${params}`,
      );
      for (const change of arr(page?.changes)) {
        if (!validId(change?.fileId)) {
          this.skipped++;
          continue;
        }
        if (change.removed === true || change.file?.trashed === true)
          files.set(change.fileId, undefined);
        else if (change.file?.id === change.fileId) files.set(change.fileId, change.file);
        else this.skipped++;
      }
      const next = this.next(page?.nextPageToken, seen);
      if (next) {
        pageToken = next;
        continue;
      }
      const cursor = token(page?.newStartPageToken);
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
    for (const content of CONTENTS) await this.ctx.remove(`${root(id)}${content}`);
    await this.ctx.remove(`${root(id)}meta.ttl`);
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
    if (!folder) await this.content(file, item, old, path, mimeType);
    else await this.clean(path, [], old.encodings.size > 0);
    await this.ctx.write({
      slug,
      category: "documents",
      forClass: CLASSES.DigitalDocument,
      dataset,
      registrationContainer: "drive/",
    });
  }

  private async clean(path: string, keep: readonly string[], needed: boolean): Promise<void> {
    if (needed)
      for (const content of CONTENTS)
        if (!keep.includes(content)) await this.ctx.remove(`${path}${content}`);
  }

  private async content(
    file: DriveFile,
    item: DriveMetadata,
    old: DriveMetadata,
    path: string,
    mimeType: string | undefined,
  ): Promise<void> {
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
    const names = exporting
      ? mimeType === `${GOOGLE_APPS}document`
        ? ["content.pdf", "content.txt"]
        : ["content.pdf"]
      : ["content"];
    const sameVersion =
      (item.checksum !== undefined || item.dateModified !== undefined) &&
      item.checksum === old.checksum &&
      item.dateModified?.getTime() === old.dateModified?.getTime();
    const unchanged =
      sameVersion &&
      old.encodingFormat === mimeType &&
      !old.contentSkipped &&
      names.every((name) => old.encodings.has(this.ctx.resolve(`${path}${name}`)));
    let wrote = false;
    if (!reason && !unchanged) {
      for (const name of names) {
        const type = exporting
          ? name.endsWith("pdf")
            ? "application/pdf"
            : "text/plain"
          : binaryType(mimeType as string);
        const url = `${DRIVE_API}/files/${encodeURIComponent(file.id)}${exporting ? `/export?${new URLSearchParams({ mimeType: type })}` : "?alt=media"}`;
        const result = await download(
          this.ctx.api,
          url,
          exporting ? Math.min(this.maxBytes, 10 * 1024 * 1024) : this.maxBytes,
          exporting,
        );
        if ("reason" in result) {
          reason = result.reason;
          break;
        }
        await this.ctx.writeBinary({
          slug: `${path}${name}`,
          contentType: type,
          body: result.body,
          mode: "replace",
        });
        wrote = true;
      }
    }
    item.contentSkipped = reason;
    if (!reason) for (const name of names) item.encodings.add(this.ctx.resolve(`${path}${name}`));
    await this.clean(path, reason ? [] : names, wrote || old.encodings.size > 0);
  }
}
