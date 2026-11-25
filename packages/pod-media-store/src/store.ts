// AUTHORED-BY Claude Sonnet 5.5
import { displayNameOf, type Entry, type ReadResult, StorageError } from "@jeswr/storage-client";
import { isExactChildUrl, retryOnConflict } from "@jeswr/storage-client/helpers";
import { decodeCursor, encodeCursor, type ListPosition } from "./cursor.js";
import {
  fail,
  isStorageCode,
  MediaFailure,
  type MediaStoreError,
  type Result,
  run,
  throwIfAborted,
  toError,
} from "./errors.js";
import type { ExposureState } from "./exposure.js";
import {
  baseType,
  DESCRIPTION_ACCEPT,
  DESCRIPTION_TYPES,
  defaultSleep,
  loadBytes,
  normaliseDescription,
  readBounded,
  sha256Hex,
} from "./io.js";
import { createMemoryJournal, type DeleteJournalEntry } from "./journal.js";
import {
  isInsideLibrary,
  isShardUrl,
  MONTH,
  segmentOf,
  shardChildOf,
  shardKeyOf,
  YEAR,
} from "./scope.js";
import { defaultSniff, type Sniffed } from "./sniff.js";
import type {
  Current,
  ListOptions,
  ListPage,
  MediaItem,
  MediaStore,
  MediaStoreOptions,
  PutInput,
  PutOutcome,
  ResumeSummary,
  SerializedDescription,
  SkipCounts,
} from "./types.js";

const MiB = 1024 * 1024;
const NAME_TAKEN = ["conflict", "precondition-failed"];

/** A resource this call created. `etag` is the create response's own validator, if it had one. */
interface Owned {
  url: string;
  etag: string | undefined;
  role: "description" | "media";
}

type Loaded<T> =
  | { state: "ok"; item: MediaItem<T> }
  | { state: "pending" | "unparseable" | "outOfScope" };

interface Document {
  etag: string | null;
  contentType: string;
  text: string;
  byteLength: number;
  modified: Date | null;
}

interface Prepared {
  bytes: Uint8Array;
  sniffed: Sniffed;
  sha256: string;
  key: string;
  thumbnail: { bytes: Uint8Array; sniffed: Sniffed } | undefined;
}

function normaliseExtension(value: string): string {
  const lower = value.trim().toLowerCase().replace(/^\./, "");
  return lower === "jpeg" ? "jpg" : lower;
}

/**
 * Open the store: validate the options and look the library up through the Type Index
 * (read-only; nothing is created or registered until the first `put`).
 */
export async function openMediaStore<T, I>(
  options: MediaStoreOptions<T, I>,
): Promise<Result<MediaStore<T, I>>> {
  const { storage, typeIndex, classes } = options;
  const name = options.defaultContainerName;
  const sniff = options.sniff ?? defaultSniff;
  const maxBytes = options.maxBytes ?? 50 * MiB;
  const maxThumbnailBytes = options.maxThumbnailBytes ?? 5 * MiB;
  const maxDescriptionBytes = options.maxDescriptionBytes ?? MiB;
  const concurrency = options.concurrency ?? 4;
  const updateAttempts = options.updateAttempts ?? 4;
  const exposureTtlMs = options.exposureTtlMs ?? 60_000;
  const pendingPolls = options.pendingPolls ?? 5;
  const pendingDelayMs = options.pendingDelayMs ?? 100;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const journal = options.journal ?? createMemoryJournal();
  const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
  if (
    options.features.protocol !== storage.protocol ||
    classes.length === 0 ||
    name === "" ||
    name === "." ||
    name === ".." ||
    /[/\\?#\p{Cc}]/u.test(name) ||
    ![maxBytes, maxThumbnailBytes, maxDescriptionBytes, concurrency, updateAttempts].every(positive)
  ) {
    return { ok: false, error: toError(fail("failed", "invalid-input"), undefined) };
  }

  let library: string | null = null;
  const children = new Map<string, string>();
  let privateUntil = 0;

  // ---- containment ---------------------------------------------------------------------
  // On Solid a URL's path says where it lives. On LWS identifiers are opaque and containment is
  // logical, so membership is proven by `parentOf` (the server's `up` link) or remembered from a
  // listing or create this store performed itself.
  const lws = storage.protocol === "lws";
  const verifiedShards = new Set<string>();
  const memberShard = new Map<string, string>();

  /** A listed or created child of `shardUrl` (a listing is authoritative on LWS). */
  const isMember = (shardUrl: string, url: string): boolean =>
    lws ? storage.isWithinStorage(url) && !/[?#]/.test(url) : isExactChildUrl(shardUrl, url);

  async function shardInLibrary(
    lib: string,
    shard: string,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    if (verifiedShards.has(shard)) return true;
    let inside: boolean;
    if (lws) {
      const year = await parentOf(shard, signal);
      inside = year !== undefined && (await parentOf(year, signal)) === lib;
    } else {
      inside = isShardUrl(lib, shard);
    }
    if (inside) verifiedShards.add(shard);
    return inside;
  }

  async function parentOf(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    if (!storage.isWithinStorage(url) || /[?#]/.test(url)) return undefined;
    try {
      const parent = await storage.parentOf(url);
      throwIfAborted(signal);
      return parent ?? undefined;
    } catch (cause) {
      if (signal?.aborted || isStorageCode(cause, "network")) throw cause;
      return undefined;
    }
  }

  /** The shard container `url` is a direct member of, if that shard belongs to the library. */
  async function shardOfMember(
    lib: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    if (!lws) return shardChildOf(lib, url)?.shardUrl;
    const known = memberShard.get(url);
    if (known !== undefined) return known;
    const parent = await parentOf(url, signal);
    if (parent === undefined || !(await shardInLibrary(lib, parent, signal))) return undefined;
    memberShard.set(url, parent);
    return parent;
  }

  // ---- discovery and layout -------------------------------------------------------------

  const isCandidate = (url: string): boolean =>
    url.endsWith("/") && url !== storage.root && !/[?#]/.test(url) && storage.isWithinStorage(url);

  async function discover(signal: AbortSignal | undefined): Promise<string | null> {
    const found = await typeIndex.findAll([...classes]);
    throwIfAborted(signal);
    for (const cls of classes) {
      const urls = (found.get(cls) ?? []).filter(isCandidate).sort();
      if (urls[0] !== undefined) {
        library = urls[0];
        return library;
      }
    }
    return null;
  }

  const noLibrary = (): never => {
    throw fail("not-found", "no-library");
  };

  async function resolveLibrary(signal: AbortSignal | undefined): Promise<string> {
    const url = library ?? (await discover(signal));
    return url ?? noLibrary();
  }

  async function findChild(
    parent: string,
    childName: string,
    kind: "container" | "resource",
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    for await (const entry of storage.listAll(parent, { signal })) {
      const label = kind === "container" ? displayNameOf(entry) : segmentOf(entry.url);
      if (entry.kind === kind && label === childName && isMember(parent, entry.url)) {
        return entry.url;
      }
    }
    return undefined;
  }

  async function ensureChild(
    parent: string,
    childName: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const cacheKey = `${parent}\n${childName}`;
    const cached = children.get(cacheKey);
    if (cached !== undefined) return cached;
    let url = await findChild(parent, childName, "container", signal);
    if (url === undefined) {
      try {
        url = (await storage.create(parent, null, { kind: "container", name: childName, signal }))
          .url;
      } catch (cause) {
        if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
        url = await findChild(parent, childName, "container", signal);
        if (url === undefined) throw fail("failed", "name-unavailable");
      }
    }
    children.set(cacheKey, url);
    return url;
  }

  async function ensureLibrary(signal: AbortSignal | undefined): Promise<string> {
    const known = library ?? (await discover(signal));
    if (known !== null) return known;
    let url: string;
    if (storage.protocol === "solid") {
      try {
        url = (await storage.create(storage.root, null, { kind: "container", name, signal })).url;
      } catch (cause) {
        if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
        const adopted = await findChild(storage.root, name, "container", signal);
        if (adopted === undefined) throw fail("failed", "name-unavailable");
        url = adopted;
      }
      for (const cls of classes) await typeIndex.register(cls, { container: url });
    } else {
      // LWS declares the class when the resource is created, so the hint comes first.
      const links = [];
      for (const cls of classes) {
        links.push(...((await typeIndex.register(cls, { container: storage.root }))?.links ?? []));
      }
      url = (await storage.create(storage.root, null, { kind: "container", name, links, signal }))
        .url;
    }
    throwIfAborted(signal);
    library = url;
    return url;
  }

  // ---- exposure --------------------------------------------------------------------------

  async function exposureState(signal: AbortSignal | undefined): Promise<ExposureState> {
    const probe = options.exposure;
    if (probe === undefined) return "unknown";
    const target = library ?? (await discover(signal)) ?? storage.root;
    let state: ExposureState;
    try {
      state = await probe(target, signal);
    } catch (cause) {
      if (signal?.aborted) throw cause;
      state = "unknown";
    }
    if (state === "private") privateUntil = now() + exposureTtlMs;
    return state;
  }

  async function requireNotExposed(signal: AbortSignal | undefined): Promise<void> {
    if (options.exposure === undefined || now() < privateUntil) return;
    const state = await exposureState(signal);
    if (state === "exposed") throw fail("exposed", "library-exposed");
    if (state === "unknown" && options.refuseUnknownExposure === true) {
      throw fail("exposed", "exposure-unknown");
    }
  }

  // ---- reading descriptions --------------------------------------------------------------

  async function readDocument(url: string, signal: AbortSignal | undefined): Promise<Document> {
    const result = await storage.read(url, { accept: DESCRIPTION_ACCEPT, signal });
    if (result.kind === "container") throw fail("failed", "not-a-document");
    const bytes = await readBounded(result, maxDescriptionBytes, () =>
      fail("too-large", "description-too-large"),
    );
    return {
      etag: result.etag,
      contentType: result.contentType ?? "text/turtle",
      text: new TextDecoder().decode(bytes),
      byteLength: bytes.byteLength,
      modified: result.lastModified,
    };
  }

  async function safely<R>(
    signal: AbortSignal | undefined,
    fn: () => Promise<R> | R,
  ): Promise<R | undefined> {
    try {
      return await fn();
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return undefined;
    }
  }

  async function interpret(
    lib: string,
    url: string,
    doc: Document,
    signal: AbortSignal | undefined,
  ): Promise<Loaded<T>> {
    if (doc.byteLength === 0) return { state: "pending" };
    const value = await safely(signal, () => options.parse(url, doc.text, doc.contentType));
    if (value === undefined) return { state: "unparseable" };
    const where = await safely(signal, () => options.locate(value));
    if (where === undefined) return { state: "unparseable" };
    const binaryUrl = where.binaryUrl;
    if (binaryUrl === undefined || (await shardOfMember(lib, binaryUrl, signal)) === undefined) {
      return { state: "outOfScope" };
    }
    const thumbnailUrl =
      where.thumbnailUrl !== undefined &&
      (await shardOfMember(lib, where.thumbnailUrl, signal)) !== undefined
        ? where.thumbnailUrl
        : undefined;
    return {
      state: "ok",
      item: {
        descriptionUrl: url,
        value,
        binaryUrl,
        thumbnailUrl,
        etag: doc.etag,
        modified: doc.modified,
      },
    };
  }

  async function loadItem(
    lib: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<Loaded<T>> {
    return interpret(lib, url, await readDocument(url, signal), signal);
  }

  /** A description for `hash` in the shard, if any resource carries that name. */
  const findDescription = (shardUrl: string, hash: string, signal: AbortSignal | undefined) =>
    findChild(shardUrl, hash, "resource", signal);

  // ---- put -------------------------------------------------------------------------------

  async function prepare(input: PutInput<I>): Promise<Prepared> {
    const bytes = await loadBytes(input.bytes, maxBytes);
    throwIfAborted(input.signal);
    const sniffed = sniff(bytes);
    if (
      sniffed === undefined ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(sniffed.contentType) ||
      !/^\.[a-z0-9]{1,8}$/.test(sniffed.extension)
    ) {
      throw fail("unsupported", "unsniffable");
    }
    if (
      baseType(input.contentType) !== sniffed.contentType ||
      normaliseExtension(input.extension) !== normaliseExtension(sniffed.extension)
    ) {
      throw fail("unsupported", "type-mismatch");
    }
    const key = shardKeyOf(input.createdAt);
    if (key === undefined) throw fail("failed", "invalid-input");
    let thumbnail: Prepared["thumbnail"];
    if (input.thumbnail !== undefined) {
      const thumbBytes = await loadBytes(input.thumbnail.bytes, maxThumbnailBytes);
      const thumbSniffed = sniff(thumbBytes);
      if (thumbSniffed === undefined || !thumbSniffed.contentType.startsWith("image/")) {
        throw fail("unsupported", "unsniffable");
      }
      thumbnail = { bytes: thumbBytes, sniffed: thumbSniffed };
    }
    const sha256 = await sha256Hex(bytes);
    throwIfAborted(input.signal);
    return { bytes, sniffed, sha256, key, thumbnail };
  }

  const track = (
    created: { url: string; etag: string | null; etagSource?: string },
    role: Owned["role"],
  ): Owned => ({
    url: created.url,
    etag: created.etagSource === "response" && created.etag !== null ? created.etag : undefined,
    role,
  });

  /** Hash the bytes behind `url`, reading at most `max`. */
  async function hashOf(
    url: string,
    max: number,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const result = await storage.read(url, { signal });
    const bytes = await readBounded(result, max, () => fail("too-large", "bytes-too-large"));
    return sha256Hex(bytes);
  }

  /** Create `name`, or adopt the resource already at that name if its bytes hash to `hash`. */
  async function createOrAdopt(
    shardUrl: string,
    fileName: string,
    bytes: Uint8Array,
    contentType: string,
    hash: string,
    signal: AbortSignal | undefined,
    owned: Owned[],
  ): Promise<string> {
    try {
      const created = await storage.create(shardUrl, bytes, {
        name: fileName,
        contentType,
        signal,
      });
      owned.push(track(created, "media"));
      return created.url;
    } catch (cause) {
      if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
    }
    const existing = await findChild(shardUrl, fileName, "resource", signal);
    if (existing === undefined) throw fail("conflict", "name-unavailable");
    if ((await hashOf(existing, maxBytes, signal)) !== hash)
      throw fail("conflict", "hash-mismatch");
    return existing;
  }

  /** A thumbnail already at its name is adopted when it is a sniffable image. */
  async function createThumbnail(
    shardUrl: string,
    fileName: string,
    thumbnail: { bytes: Uint8Array; sniffed: Sniffed },
    signal: AbortSignal | undefined,
    owned: Owned[],
  ): Promise<string> {
    try {
      const created = await storage.create(shardUrl, thumbnail.bytes, {
        name: fileName,
        contentType: thumbnail.sniffed.contentType,
        signal,
      });
      owned.push(track(created, "media"));
      return created.url;
    } catch (cause) {
      if (!isStorageCode(cause, ...NAME_TAKEN)) throw cause;
    }
    const existing = await findChild(shardUrl, fileName, "resource", signal);
    if (existing === undefined) throw fail("conflict", "name-unavailable");
    const result = await storage.read(existing, { signal });
    const bytes = await readBounded(result, maxThumbnailBytes, () =>
      fail("too-large", "bytes-too-large"),
    );
    if (!sniff(bytes)?.contentType.startsWith("image/")) throw fail("conflict", "hash-mismatch");
    return existing;
  }

  /**
   * Check a description another writer left at the hash name: it must parse and point at our
   * binary. A document still empty is being filled by a concurrent put, so poll; one that has
   * vanished is `undefined` and the caller creates it afresh.
   */
  async function adoptDescription(
    lib: string,
    shardUrl: string,
    hash: string,
    binaryUrl: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    for (let poll = 0; poll <= pendingPolls; poll++) {
      const url = await findDescription(shardUrl, hash, signal);
      if (url === undefined) return undefined;
      let loaded: Loaded<T>;
      try {
        loaded = await loadItem(lib, url, signal);
      } catch (cause) {
        if (isStorageCode(cause, "not-found")) return undefined;
        throw cause;
      }
      if (loaded.state === "ok") {
        if (loaded.item.binaryUrl !== binaryUrl) throw fail("conflict", "description-mismatch");
        return url;
      }
      if (loaded.state !== "pending") throw fail("conflict", "description-mismatch");
      await sleep(pendingDelayMs, signal);
      throwIfAborted(signal);
    }
    throw fail("conflict", "description-pending");
  }

  async function writeDescription(
    lib: string,
    shardUrl: string,
    input: PutInput<I>,
    prepared: Prepared,
    binaryUrl: string,
    thumbnailUrl: string | undefined,
    owned: Owned[],
  ): Promise<{ url: string; existed: boolean }> {
    const { signal } = input;
    const { sha256 } = prepared;
    for (let attempt = 0; attempt < 3; attempt++) {
      let created: Owned | undefined;
      try {
        const response = await storage.create(shardUrl, "", {
          name: sha256,
          contentType: "text/turtle",
          signal,
        });
        created = track(response, "description");
        owned.push(created);
        // The URL is only known now, so the document is built after the empty create.
        const built = normaliseDescription(
          await options.build(response.url, binaryUrl, input.description, {
            sha256,
            contentType: prepared.sniffed.contentType,
            byteLength: prepared.bytes.byteLength,
            createdAt: input.createdAt,
            thumbnailUrl,
          }),
          maxDescriptionBytes,
        );
        throwIfAborted(signal);
        const check = await safely(signal, () =>
          options.parse(response.url, built.body, built.contentType),
        );
        const where =
          check === undefined ? undefined : await safely(signal, () => options.locate(check));
        if (where?.binaryUrl !== binaryUrl) throw fail("failed", "description-invalid");
        const written = await storage.write(response.url, built.body, {
          contentType: built.contentType,
          ifMatch: created.etag ?? "*",
          signal,
        });
        created.etag = track(written, "description").etag;
        return { url: response.url, existed: false };
      } catch (cause) {
        if (created !== undefined || !isStorageCode(cause, ...NAME_TAKEN)) throw cause;
      }
      const adopted = await adoptDescription(lib, shardUrl, sha256, binaryUrl, signal);
      if (adopted !== undefined) return { url: adopted, existed: true };
    }
    throw fail("conflict", "description-pending");
  }

  /**
   * Remove what this call created. The description goes first. The binary and thumbnail go
   * only if no description carries the hash name any more, so another writer's description
   * that now points at those bytes is never orphaned. Deletes are conditional on the create
   * response's ETag; a resource without one is left and reported. Runs without the caller's
   * signal so an abort cannot leak resources.
   */
  async function compensate(
    shardUrl: string,
    hash: string,
    owned: readonly Owned[],
  ): Promise<string[]> {
    const orphans: string[] = [];
    const remove = async (item: Owned): Promise<void> => {
      if (item.etag === undefined) {
        orphans.push(item.url);
        return;
      }
      try {
        await storage.delete(item.url, { ifMatch: item.etag });
      } catch (cause) {
        if (!isStorageCode(cause, "not-found")) orphans.push(item.url);
      }
    };
    for (const item of owned.filter((entry) => entry.role === "description")) await remove(item);
    // Names are ours to reason about only on Solid; LWS names are server-chosen and unshared.
    if (storage.protocol === "solid" && (await claimed(shardUrl, hash))) return orphans;
    for (const item of owned.filter((entry) => entry.role === "media").reverse())
      await remove(item);
    return orphans;
  }

  /** True when a description carries the hash name, or when that cannot be established. */
  async function claimed(shardUrl: string, hash: string): Promise<boolean> {
    try {
      return (await findDescription(shardUrl, hash, undefined)) !== undefined;
    } catch {
      return true;
    }
  }

  /** A description the caller's lookup named: usable only if its binary hashes to `sha256`. */
  async function verifyKnown(
    descriptionUrl: string,
    sha256: string,
    signal: AbortSignal | undefined,
  ): Promise<PutOutcome | undefined> {
    const lib = await resolveLibrary(signal);
    let loaded: Loaded<T>;
    try {
      loaded = await loadItem(lib, descriptionUrl, signal);
    } catch (cause) {
      if (isStorageCode(cause, "not-found")) return undefined;
      throw cause;
    }
    if (loaded.state !== "ok") throw fail("conflict", "description-mismatch");
    if ((await hashOf(loaded.item.binaryUrl, maxBytes, signal)) !== sha256) {
      throw fail("conflict", "hash-mismatch");
    }
    return {
      descriptionUrl,
      binaryUrl: loaded.item.binaryUrl,
      thumbnailUrl: loaded.item.thumbnailUrl,
      sha256,
      existed: true,
    };
  }

  async function put(input: PutInput<I>): Promise<PutOutcome> {
    const { signal } = input;
    const prepared = await prepare(input);
    const { sha256 } = prepared;
    await requireNotExposed(signal);
    const known =
      options.findByHash === undefined ? undefined : await options.findByHash(sha256, signal);
    throwIfAborted(signal);
    if (known !== undefined) {
      const verified = await verifyKnown(known.descriptionUrl, sha256, signal);
      if (verified !== undefined) return verified;
    }
    const lib = await ensureLibrary(signal);
    const [year, month] = prepared.key.split("/") as [string, string];
    const shardUrl = await ensureChild(await ensureChild(lib, year, signal), month, signal);
    verifiedShards.add(shardUrl);
    const owned: Owned[] = [];
    try {
      const binaryUrl = await createOrAdopt(
        shardUrl,
        `${sha256}${prepared.sniffed.extension}`,
        prepared.bytes,
        prepared.sniffed.contentType,
        sha256,
        signal,
        owned,
      );
      const thumbnailUrl =
        prepared.thumbnail === undefined
          ? undefined
          : await createThumbnail(
              shardUrl,
              `${sha256}-thumb${prepared.thumbnail.sniffed.extension}`,
              prepared.thumbnail,
              signal,
              owned,
            );
      const description = await writeDescription(
        lib,
        shardUrl,
        input,
        prepared,
        binaryUrl,
        thumbnailUrl,
        owned,
      );
      for (const url of [description.url, binaryUrl, thumbnailUrl]) {
        if (url !== undefined) memberShard.set(url, shardUrl);
      }
      return {
        descriptionUrl: description.url,
        binaryUrl,
        thumbnailUrl,
        sha256,
        existed: description.existed && owned.length === 0,
      };
    } catch (cause) {
      const orphans = await compensate(shardUrl, sha256, owned);
      if (orphans.length === 0) throw cause;
      const error = toError(cause, signal);
      throw new MediaFailure(error.kind, error.reason, orphans);
    }
  }

  // ---- list and get ----------------------------------------------------------------------

  /** Shard containers, newest first, from `from` (inclusive) downwards. */
  async function* shardsFrom(
    lib: string,
    from: string | undefined,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<{ key: string; url: string }> {
    const named = async (parent: string, pattern: RegExp) => {
      const out: { label: string; url: string }[] = [];
      for await (const entry of storage.listAll(parent, { signal })) {
        const label = displayNameOf(entry);
        if (entry.kind === "container" && pattern.test(label) && isMember(parent, entry.url)) {
          out.push({ label, url: entry.url });
        }
      }
      // A server that picks its own names leaves nothing to match in a fresh session; shards
      // this session created are remembered by the name that was asked for.
      for (const [key, url] of children) {
        const [cachedParent, label] = key.split("\n") as [string, string];
        if (cachedParent === parent && pattern.test(label) && !out.some((one) => one.url === url)) {
          out.push({ label, url });
        }
      }
      return out.sort((a, b) => b.label.localeCompare(a.label));
    };
    for (const year of await named(lib, YEAR)) {
      if (from !== undefined && year.label > from.slice(0, 4)) continue;
      for (const month of await named(year.url, MONTH)) {
        const key = `${year.label}/${month.label}`;
        if (from === undefined || key <= from) {
          verifiedShards.add(month.url);
          yield { key, url: month.url };
        }
      }
    }
  }

  const emptySkips = (): SkipCounts => ({ foreign: 0, unparseable: 0, pending: 0, outOfScope: 0 });
  const modifiedAt = (entry: Entry): number => entry.modified?.getTime() ?? 0;
  const newestFirst = (a: Entry, b: Entry): number =>
    modifiedAt(b) - modifiedAt(a) || a.url.localeCompare(b.url);

  async function list(opts: ListOptions): Promise<ListPage<T>> {
    const { signal } = opts;
    const limit = opts.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw fail("failed", "invalid-input");
    const position = opts.cursor === undefined ? undefined : decodeCursor(opts.cursor);
    const skipped = emptySkips();
    const items: MediaItem<T>[] = [];
    const found = library ?? (await discover(signal));
    const walk = async (lib: string): Promise<ListPage<T>> => {
      const shards = shardsFrom(lib, position?.shard, signal);
      let moreShards = await shards.next();
      while (!moreShards.done) {
        const shard = moreShards.value;
        const resume: ListPosition | undefined =
          position?.shard === shard.key ? position : undefined;
        let page: string | null = resume?.page ?? null;
        let offset = resume?.offset ?? 0;
        if (page !== null && !page.startsWith(shard.url)) throw fail("failed", "invalid-cursor");
        for (;;) {
          const listing = await storage.list(shard.url, {
            ...(page === null ? {} : { cursor: { url: page } }),
            signal,
          });
          const candidates: Entry[] = [];
          for (const entry of listing.items) {
            if (!isMember(shard.url, entry.url)) {
              skipped.outOfScope++;
              continue;
            }
            memberShard.set(entry.url, shard.url);
            if (entry.kind !== "resource") skipped.foreign++;
            else if (entry.contentType === null) {
              // Type unknown: it can only be a description if it is small enough to be one.
              if ((entry.size ?? 0) > maxDescriptionBytes) skipped.foreign++;
              else candidates.push(entry);
            } else if (DESCRIPTION_TYPES.has(baseType(entry.contentType))) candidates.push(entry);
          }
          candidates.sort(newestFirst);
          let index = offset;
          while (index < candidates.length) {
            const chunk = candidates.slice(index, index + concurrency);
            const loaded = await Promise.all(
              chunk.map((entry) => loadMember(lib, entry.url, signal)),
            );
            for (const result of loaded) {
              index++;
              if (result.state === "ok") items.push(result.item);
              else skipped[result.state]++;
              if (items.length >= limit) break;
            }
            if (items.length >= limit) break;
          }
          const nextPage = listing.next?.url ?? null;
          if (items.length >= limit) {
            const remains = index < candidates.length || nextPage !== null;
            if (remains)
              return {
                items,
                next: encodeCursor({ shard: shard.key, page, offset: index }),
                skipped,
              };
            const following = await shards.next();
            return {
              items,
              next: following.done
                ? null
                : encodeCursor({ shard: following.value.key, page: null, offset: 0 }),
              skipped,
            };
          }
          if (nextPage === null) break;
          page = nextPage;
          offset = 0;
        }
        moreShards = await shards.next();
      }
      return { items, next: null, skipped };
    };
    return found === null ? { items, next: null, skipped } : walk(found);
  }

  /** One member's outcome; a bad member is skipped, a transport failure fails the page. */
  async function loadMember(
    lib: string,
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<Loaded<T>> {
    try {
      return await loadItem(lib, url, signal);
    } catch (cause) {
      if (signal?.aborted || (cause instanceof StorageError && cause.code === "network"))
        throw cause;
      return { state: "unparseable" };
    }
  }

  async function get(url: string, signal: AbortSignal | undefined): Promise<MediaItem<T>> {
    const lib = await resolveLibrary(signal);
    if ((await shardOfMember(lib, url, signal)) === undefined) {
      throw fail("not-found", "out-of-scope");
    }
    const loaded = await loadItem(lib, url, signal);
    if (loaded.state === "ok") return loaded.item;
    throw fail(
      "failed",
      loaded.state === "pending"
        ? "description-pending"
        : loaded.state === "outOfScope"
          ? "out-of-scope"
          : "description-unparseable",
    );
  }

  // ---- update ----------------------------------------------------------------------------

  async function update(
    url: string,
    mutate: (current: Current) => Promise<SerializedDescription | undefined>,
    signal: AbortSignal | undefined,
  ): Promise<MediaItem<T>> {
    const lib = await resolveLibrary(signal);
    if ((await shardOfMember(lib, url, signal)) === undefined) {
      throw fail("not-found", "out-of-scope");
    }
    let snapshot: Document | undefined;
    const attempt = async (etag: string | null): Promise<MediaItem<T>> => {
      const doc = snapshot as Document;
      if (etag === null) throw fail("failed", "no-validator");
      if (doc.byteLength === 0) throw fail("failed", "description-pending");
      const output = await mutate({ url, body: doc.text, contentType: doc.contentType });
      if (output === undefined) {
        const unchanged = await interpret(lib, url, doc, signal);
        if (unchanged.state !== "ok") throw fail("failed", "description-unparseable");
        return unchanged.item;
      }
      const next = normaliseDescription(output, maxDescriptionBytes);
      const checked = await interpret(
        lib,
        url,
        { ...doc, text: next.body, contentType: next.contentType, byteLength: next.body.length },
        signal,
      );
      if (checked.state !== "ok") throw fail("failed", "description-invalid");
      throwIfAborted(signal);
      const written = await storage.write(url, next.body, {
        contentType: next.contentType,
        ifMatch: etag,
        signal,
      });
      return { ...checked.item, etag: written.etag, modified: null };
    };
    try {
      return await retryOnConflict(
        attempt,
        async () => {
          snapshot = await readDocument(url, signal);
          return { etag: snapshot.etag };
        },
        updateAttempts,
      );
    } catch (cause) {
      if (isStorageCode(cause, "precondition-failed")) throw fail("conflict", "retries-exhausted");
      throw cause;
    }
  }

  // ---- remove ----------------------------------------------------------------------------

  /** Conditional delete: observe the ETag, delete on it, retry a lost race. Gone is done. */
  async function deleteGuarded(url: string, signal: AbortSignal | undefined): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const head = await storage.head(url, { signal });
        if (head.etag === null) throw fail("failed", "no-validator");
        await storage.delete(url, { ifMatch: head.etag, signal });
        return;
      } catch (cause) {
        if (isStorageCode(cause, "not-found")) return;
        if (!isStorageCode(cause, "precondition-failed")) throw cause;
      }
    }
    throw fail("conflict", "retries-exhausted");
  }

  const journalled = async <R>(fn: () => Promise<R>): Promise<R> => {
    try {
      return await fn();
    } catch {
      throw fail("failed", "journal");
    }
  };

  /** Step two: the binary and thumbnail, only if they sit in the description's own shard. */
  async function finish(
    lib: string,
    entry: DeleteJournalEntry,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    for (const target of [entry.binaryUrl, entry.thumbnailUrl]) {
      if (target !== undefined && (await shardOfMember(lib, target, signal)) === entry.shardUrl) {
        await deleteGuarded(target, signal);
      }
    }
    await journalled(() => journal.delete(entry.descriptionUrl));
  }

  async function remove(url: string, signal: AbortSignal | undefined): Promise<void> {
    const lib = await resolveLibrary(signal);
    const shardUrl = await shardOfMember(lib, url, signal);
    if (shardUrl === undefined) throw fail("not-found", "out-of-scope");
    for (let attempt = 0; ; attempt++) {
      if (attempt === 3) throw fail("conflict", "retries-exhausted");
      const doc = await readDocument(url, signal);
      const loaded = await interpret(lib, url, doc, signal);
      if (loaded.state === "pending") throw fail("failed", "description-pending");
      if (loaded.state === "unparseable") throw fail("failed", "description-unparseable");
      const entry: DeleteJournalEntry =
        loaded.state === "ok"
          ? {
              descriptionUrl: url,
              shardUrl,
              binaryUrl: loaded.item.binaryUrl,
              ...(loaded.item.thumbnailUrl === undefined
                ? {}
                : { thumbnailUrl: loaded.item.thumbnailUrl }),
            }
          : { descriptionUrl: url, shardUrl };
      if (doc.etag === null) throw fail("failed", "no-validator");
      await journalled(() => journal.put(entry));
      try {
        await storage.delete(url, { ifMatch: doc.etag, signal });
      } catch (cause) {
        if (isStorageCode(cause, "precondition-failed")) continue;
        if (!isStorageCode(cause, "not-found")) throw cause;
      }
      await finish(lib, entry, signal);
      return;
    }
  }

  async function resumePending(signal: AbortSignal | undefined): Promise<ResumeSummary> {
    const entries = await journalled(() => journal.list());
    const summary: ResumeSummary = { completed: 0, failed: 0, rejected: 0 };
    const lib = library ?? (await discover(signal));
    for (const entry of entries) {
      throwIfAborted(signal);
      if (lib === null) {
        summary.failed++;
        continue;
      }
      let ours: boolean;
      try {
        ours = await shardInLibrary(lib, entry.shardUrl, signal);
      } catch (cause) {
        if (signal?.aborted) throw cause;
        summary.failed++;
        continue;
      }
      if (!ours) {
        // Not ours: a stale or tampered record is dropped and never acted on.
        await journalled(() => journal.delete(entry.descriptionUrl));
        summary.rejected++;
        continue;
      }
      try {
        await finish(lib, entry, signal);
        summary.completed++;
      } catch (cause) {
        if (signal?.aborted) throw cause;
        summary.failed++;
      }
    }
    return summary;
  }

  // ---- surface ---------------------------------------------------------------------------

  const store: MediaStore<T, I> = {
    get library() {
      return library;
    },
    isInsideLibrary: (url) =>
      library !== null &&
      (lws ? memberShard.has(url) || verifiedShards.has(url) : isInsideLibrary(library, url)),
    checkExposure: (signal) => run(signal, () => exposureState(signal)),
    put: (input) => run(input.signal, () => put(input)),
    list: (opts = {}) => run(opts.signal, () => list(opts)),
    get: (url, signal) => run(signal, () => get(url, signal)),
    update: (url, mutate, opts = {}) => run(opts.signal, () => update(url, mutate, opts.signal)),
    remove: (url, signal) => run(signal, () => remove(url, signal)),
    resumePending: (signal) => run(signal, () => resumePending(signal)),
  };
  const opened = await run(options.signal, () => discover(options.signal));
  return opened.ok
    ? { ok: true, value: store }
    : { ok: false, error: opened.error as MediaStoreError };
}

export type { ReadResult };
