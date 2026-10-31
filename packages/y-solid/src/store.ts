// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, normalizePodBase } from "@jeswr/guarded-fetch";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { compareRecords, decodeRecord, encodeRecord } from "./record.js";

export const UPDATE_CONTENT_TYPE = "application/octet-stream";
export const DEFAULT_MAX_UPDATE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_LISTING_BYTES = 16 * 1024 * 1024;

export interface StoredUpdate {
  readonly url: string;
  /** Yjs payload, without the wire header. */
  readonly update: Uint8Array;
  readonly etag: string | null;
  readonly kind: "update" | "snapshot";
  readonly timestamp: bigint;
  readonly random: number;
}

export interface SolidUpdateStoreOptions {
  container: string;
  storage: StorageClient;
  /** Includes the 16-byte wire header. */
  maxUpdateBytes?: number;
  /** Budget for listed entry metadata; raw listing transport limits belong to StorageClient. */
  maxListingBytes?: number;
  /** Maximum passes when concurrent compaction removes listed members. Default 5. */
  maxLoadRounds?: number;
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

function missing(cause: unknown): boolean {
  return cause instanceof StorageError && (cause.code === "not-found" || cause.status === 410);
}

function validator(etag: string | null): etag is string {
  return etag !== null && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag);
}

/** Immutable Yjs log over the public, protocol-neutral storage API. */
export class SolidUpdateStore {
  readonly container: string;
  readonly storage: StorageClient;
  private readonly maxUpdateBytes: number;
  private readonly maxListingBytes: number;
  private readonly maxLoadRounds: number;
  private readonly observed = new Map<string, StoredUpdate>();

  constructor(options: SolidUpdateStoreOptions) {
    this.storage = options.storage;
    this.container =
      this.storage.protocol === "solid"
        ? normalizePodBase(options.container)
        : assertWithinPodScope(this.storage.root, options.container);
    if (!this.storage.isWithinStorage(this.container)) {
      throw new Error("[y-solid] container escapes storage scope");
    }
    this.maxUpdateBytes = positive(options.maxUpdateBytes, DEFAULT_MAX_UPDATE_BYTES);
    this.maxListingBytes = positive(options.maxListingBytes, DEFAULT_MAX_LISTING_BYTES);
    this.maxLoadRounds = positive(options.maxLoadRounds, 5);
  }

  private target(url: string): string {
    return assertWithinPodScope(
      this.storage.protocol === "solid" ? this.container : this.storage.root,
      url,
      { allowRoot: false },
    );
  }

  private async member(url: string): Promise<string> {
    const target = this.target(url);
    if (
      target === this.container ||
      (this.storage.protocol === "lws" && (await this.storage.parentOf(target)) !== this.container)
    ) {
      throw new Error("[y-solid] resource is not a member of the document container");
    }
    return target;
  }

  private async create(update: Uint8Array, kind: StoredUpdate["kind"]): Promise<{ url: string }> {
    const { bytes, name } = encodeRecord(update, kind);
    const result = await this.storage.create(this.container, bytes, {
      contentType: UPDATE_CONTENT_TYPE,
      name,
    });
    if (result.created !== true) throw new Error("[y-solid] create was not confirmed");
    const url = await this.member(result.url);
    return { url };
  }

  async appendUpdate(update: Uint8Array): Promise<{ url: string }> {
    return this.create(update, "update");
  }

  /** Names are opaque hints. This method lists URLs; loadUpdates orders their headers. */
  async listUpdateUrls(): Promise<string[]> {
    const urls = new Set<string>();
    let size = 0;
    try {
      for await (const entry of this.storage.listAll(this.container, { revalidate: true })) {
        size += new TextEncoder().encode(JSON.stringify(entry)).byteLength;
        if (size > this.maxListingBytes) throw new Error("[y-solid] listing exceeds max size");
        if (entry.kind === "container") continue;
        try {
          const url = this.target(entry.url);
          if (url !== this.container) urls.add(url);
        } catch {
          // Untrusted membership never expands the credential scope.
        }
      }
    } catch (cause) {
      if (!missing(cause)) throw cause;
      return [];
    }
    return [...urls].sort();
  }

  private async readRecord(url: string): Promise<StoredUpdate | null> {
    try {
      const target = await this.member(url);
      const result = await this.storage.read(target, { accept: UPDATE_CONTENT_TYPE });
      // Consume the public stream, never bytes() before enforcing the cap.
      const reader = result.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > this.maxUpdateBytes) {
              await reader.cancel().catch(() => {});
              throw new Error("[y-solid] update exceeds max size");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const record = { url: target, etag: result.etag, ...decodeRecord(bytes, target) };
      this.observed.set(target, record);
      return record;
    } catch (cause) {
      if (missing(cause)) return null;
      throw cause;
    }
  }

  async readUpdate(url: string): Promise<Uint8Array | null> {
    return (await this.readRecord(url))?.update ?? null;
  }

  /** Replay all snapshots, then all updates, including offline writes with older timestamps. */
  async loadUpdates(knownUrls: ReadonlySet<string> = new Set()): Promise<StoredUpdate[]> {
    const read = new Map<string, StoredUpdate>();
    for (let round = 0; round < this.maxLoadRounds; round++) {
      let vanished = false;
      for (const url of await this.listUpdateUrls()) {
        if (knownUrls.has(url) || read.has(url)) continue;
        const record = await this.readRecord(url);
        if (record) read.set(url, record);
        else vanished = true;
      }
      if (!vanished) return [...read.values()].sort(compareRecords);
    }
    throw new Error("[y-solid] log did not stabilise during concurrent compaction");
  }

  async deleteUpdate(url: string): Promise<void> {
    const target = await this.member(url);
    const record = this.observed.get(target) ?? (await this.readRecord(target));
    if (!record) return;
    if (!validator(record.etag)) throw new Error("[y-solid] deletion requires a strong read ETag");
    await this.deleteObserved(record);
  }

  private async deleteObserved(record: StoredUpdate): Promise<void> {
    try {
      await this.storage.delete(record.url, { ifMatch: record.etag as string });
      this.observed.delete(record.url);
    } catch (cause) {
      if (!missing(cause)) throw cause;
    }
  }

  /** Only retire the exact versions folded by the caller, after a confirmed snapshot create. */
  async compact(
    merged: Uint8Array,
    obsolete: readonly (string | StoredUpdate)[],
  ): Promise<{ url: string }> {
    // Validate every target before creating anything. Capture validators before the create.
    const records: StoredUpdate[] = [];
    for (const item of obsolete) {
      let url: string;
      try {
        url = await this.member(typeof item === "string" ? item : item.url);
      } catch (cause) {
        // Another compactor may already have retired the version we folded.
        if (missing(cause)) continue;
        throw cause;
      }
      const record = typeof item === "string" ? this.observed.get(url) : item;
      if (!record) throw new Error("[y-solid] compaction requires the records that were read");
      records.push({ ...record, url });
    }
    const created = await this.create(merged, "snapshot");
    for (const record of records) {
      // No validator means retain the original. Never guess '*' or a later HEAD's ETag.
      if (record.url !== created.url && validator(record.etag)) await this.deleteObserved(record);
    }
    return created;
  }
}
