// AUTHORED-BY Claude Sonnet 5.5
import type { StorageClient } from "@jeswr/storage-client";
import { imageDimensions } from "./dimensions.js";
import {
  codeOfStorageError,
  fail,
  type MediaErrorCode,
  MediaFailure,
  ok,
  type Result,
} from "./errors.js";
import { raceAbort, readBounded } from "./read.js";
import { defaultSniff, type Sniffer } from "./sniff.js";
import { canonicalMediaUrl, type MediaScope, scopeTest } from "./url.js";

/** The sniffed types shown by default. SVG, HTML, XML and every text or markup type are never on it. */
export const DEFAULT_ALLOWED_TYPES: readonly string[] = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/flac",
  "model/gltf-binary",
]);

/** The type of the `Blob` returned for anything else in `inert` mode. */
export const INERT_TYPE = "application/octet-stream";

/** Only passive media families, and nothing that can carry script or markup. */
const ALLOWABLE = /^(?:image|audio|video|model)\/[a-z0-9][a-z0-9.+-]*$/;
const ACTIVE = /svg|xml|html|script/;

export interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export interface MediaLoaderOptions {
  /** The public `StorageClient` from `createPodClient`. Every read goes through it. */
  storage: StorageClient;
  /** A predicate over the canonical URL, or container URLs the media must live strictly under. */
  scope: MediaScope;
  /** Largest single resource, counted while streaming. */
  maxBytes: number;
  /** Largest sum of all live object URLs' bytes. */
  maxTotalBytes: number;
  /** Largest number of live object URLs. */
  maxEntries: number;
  /** Refuse images whose header declares more pixels than this, before the caller decodes them. */
  maxPixels?: number;
  /** Replace the magic-byte sniffer. Its answer must still be on `allow`. */
  sniff?: Sniffer;
  /** Replace the allowlist of sniffed content types. Active types are refused at creation. */
  allow?: readonly string[];
  /** Inject `URL.createObjectURL` / `URL.revokeObjectURL` (tests, non-browser hosts). */
  objectUrls?: ObjectUrlApi;
}

export interface AcquireOptions {
  signal?: AbortSignal;
  /** Return anything off the allowlist as `application/octet-stream` (download-only) instead of refusing. */
  inert?: boolean;
}

export interface MediaHandle {
  /** A `blob:` object URL. Valid until `release()` and eviction or `purge()`. */
  readonly url: string;
  /** The SNIFFED type the `Blob` carries (`application/octet-stream` for inert fallbacks). */
  readonly contentType: string;
  readonly bytes: number;
  /** Give the hold back. Idempotent. */
  release(): void;
}

export interface MediaLoaderStats {
  /** Live (not revoked) object URLs, held or not. */
  readonly entries: number;
  readonly bytes: number;
  readonly inFlight: number;
  readonly purged: boolean;
}

export interface MediaLoader {
  acquire(url: string, options?: AcquireOptions): Promise<Result<MediaHandle>>;
  /**
   * Conditionally re-read the cached entry for `url`. `changed: true` means new acquirers get a
   * new object URL (or none, for a refused resource); existing holders keep theirs until release.
   */
  revalidate(
    url: string,
    options?: { signal?: AbortSignal },
  ): Promise<Result<{ changed: boolean }>>;
  /** Drop the cached entry (and stop sharing any read in flight) for notification-driven updates. */
  invalidate(url: string): void;
  /** Revoke everything, abort every read, and refuse until `resume()`. For sign-out and account switch. */
  purge(): void;
  resume(): void;
  stats(): MediaLoaderStats;
}

interface CacheEntry {
  readonly key: string;
  readonly objectUrl: string;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string | null;
  /** True for an inert fallback: an `application/octet-stream` blob, never shown as media. */
  readonly opaque: boolean;
  refs: number;
  revoked: boolean;
}

interface Flight {
  readonly controller: AbortController;
  readonly epoch: number;
  promise: Promise<Result<CacheEntry>>;
  waiters: number;
  inert: boolean;
  /** Invalidated while in flight: serve its own waiters, but never share it with new acquirers. */
  detached: boolean;
  done: boolean;
}

interface Downloaded {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly opaque: boolean;
  readonly etag: string | null;
}

const ABORTED = Symbol("aborted");

function positiveInteger(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function allowSet(allow: readonly string[]): ReadonlySet<string> {
  for (const type of allow) {
    if (typeof type !== "string" || !ALLOWABLE.test(type) || ACTIVE.test(type)) {
      throw new TypeError("allow may list only passive image, audio, video or model types");
    }
  }
  return new Set(allow);
}

export function createMediaLoader(options: MediaLoaderOptions): MediaLoader {
  const { storage } = options;
  const maxEntries = positiveInteger("maxEntries", options.maxEntries);
  const maxTotalBytes = positiveInteger("maxTotalBytes", options.maxTotalBytes);
  const maxBytes = Math.min(positiveInteger("maxBytes", options.maxBytes), maxTotalBytes);
  const maxPixels =
    options.maxPixels === undefined ? undefined : positiveInteger("maxPixels", options.maxPixels);
  const allowed = allowSet(options.allow ?? DEFAULT_ALLOWED_TYPES);
  const sniff = options.sniff ?? defaultSniff;
  const urls: ObjectUrlApi = options.objectUrls ?? URL;
  const inScope = scopeTest(options.scope);

  /** The current entry per URL, in LRU order: the first key is the least recently used. */
  const entries = new Map<string, CacheEntry>();
  /** Every entry whose object URL has not been revoked: current ones plus superseded held ones. */
  const live = new Set<CacheEntry>();
  const inflight = new Map<string, Flight>();
  const active = new Set<AbortController>();
  let totalBytes = 0;
  let epoch = 0;
  let purged = false;

  function revoke(entry: CacheEntry): void {
    entry.revoked = true;
    live.delete(entry);
    totalBytes -= entry.size;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    try {
      urls.revokeObjectURL(entry.objectUrl);
    } catch {
      // A failing revoke leaves nothing to retry; the entry is already unreachable.
    }
  }

  /** Stop sharing `entry`; revoke it now unless someone still holds it. */
  function retire(entry: CacheEntry): void {
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (entry.refs === 0) revoke(entry);
  }

  /** LRU eviction: only entries nobody holds, oldest first, until both bounds hold. */
  function enforceLimits(): void {
    while (live.size > maxEntries || totalBytes > maxTotalBytes) {
      let victim: CacheEntry | undefined;
      for (const candidate of entries.values()) {
        if (candidate.refs === 0) {
          victim = candidate;
          break;
        }
      }
      if (victim === undefined) return;
      revoke(victim);
    }
  }

  function releaseEntry(entry: CacheEntry): void {
    entry.refs--;
    if (entry.revoked || entry.refs > 0) return;
    if (entries.get(entry.key) === entry) enforceLimits();
    else revoke(entry);
  }

  function handleFor(entry: CacheEntry): MediaHandle {
    let released = false;
    return Object.freeze({
      url: entry.objectUrl,
      contentType: entry.contentType,
      bytes: entry.size,
      release(): void {
        if (released) return;
        released = true;
        releaseEntry(entry);
      },
    });
  }

  /** Create the object URL. Synchronous with the guard that precedes it at every call site. */
  function createEntry(key: string, d: Downloaded, refs: number): CacheEntry {
    const blob = new Blob([d.bytes as BlobPart], { type: d.contentType });
    const entry: CacheEntry = {
      key,
      objectUrl: urls.createObjectURL(blob),
      contentType: d.contentType,
      size: d.bytes.byteLength,
      etag: d.etag,
      opaque: d.opaque,
      refs,
      revoked: false,
    };
    live.add(entry);
    totalBytes += entry.size;
    return entry;
  }

  function place(entry: CacheEntry): void {
    const previous = entries.get(entry.key);
    if (previous !== undefined) retire(previous);
    entries.set(entry.key, entry);
    enforceLimits();
  }

  function classify(bytes: Uint8Array, inert: boolean): { contentType: string; opaque: boolean } {
    const sniffed = sniff(bytes);
    if (sniffed === undefined || !allowed.has(sniffed.contentType)) {
      if (!inert) throw new MediaFailure("unsupported-type");
      return { contentType: INERT_TYPE, opaque: true };
    }
    const { contentType } = sniffed;
    if (maxPixels !== undefined && contentType.startsWith("image/")) {
      const size = imageDimensions(contentType, bytes);
      if (size === undefined || size.width < 1 || size.height < 1) {
        throw new MediaFailure("unsupported-type");
      }
      if (size.width * size.height > maxPixels) throw new MediaFailure("too-large");
    }
    return { contentType, opaque: false };
  }

  /** One bounded, scoped read. Throws `MediaFailure` or a storage error; `undefined` is a 304. */
  async function download(
    key: string,
    signal: AbortSignal,
    ifNoneMatch: string | undefined,
    inert: () => boolean,
  ): Promise<Downloaded | undefined> {
    const result = await raceAbort(
      storage.read(key, ifNoneMatch === undefined ? { signal } : { signal, ifNoneMatch }),
      signal,
      (late) => {
        late.body?.cancel().catch(() => undefined);
      },
    );
    if (result.status === 304) {
      if (ifNoneMatch === undefined) throw new MediaFailure("failed");
      return undefined;
    }
    if (result.status !== 200) throw new MediaFailure("failed");
    const bytes = await readBounded(result.body, maxBytes, signal);
    const { contentType, opaque } = classify(bytes, inert());
    return { bytes, contentType, opaque, etag: result.etag };
  }

  /** The closed code for anything thrown while a read of this epoch was running. */
  function codeOfFailure(error: unknown, signal: AbortSignal, readEpoch: number): MediaErrorCode {
    if (purged || epoch !== readEpoch) return "purged";
    if (signal.aborted) return "aborted";
    return error instanceof MediaFailure ? error.code : codeOfStorageError(error);
  }

  async function runFlight(key: string, flight: Flight): Promise<Result<CacheEntry>> {
    const { signal } = flight.controller;
    let outcome: Result<CacheEntry>;
    try {
      const downloaded = (await download(key, signal, undefined, () => flight.inert)) as Downloaded;
      // From here to the object URL nothing awaits: the purge guard cannot be overtaken.
      if (purged || epoch !== flight.epoch) throw new MediaFailure("purged");
      // Waiter aborts after this point cannot change the count that `refs` takes.
      flight.done = true;
      const entry = createEntry(key, downloaded, flight.waiters);
      if (!flight.detached) place(entry);
      outcome = ok(entry);
    } catch (error) {
      outcome = fail(codeOfFailure(error, signal, flight.epoch));
    }
    flight.done = true;
    active.delete(flight.controller);
    if (inflight.get(key) === flight) inflight.delete(key);
    return outcome;
  }

  function startFlight(key: string, inert: boolean): Flight {
    const flight: Flight = {
      controller: new AbortController(),
      epoch,
      promise: undefined as unknown as Promise<Result<CacheEntry>>,
      waiters: 0,
      inert,
      detached: false,
      done: false,
    };
    active.add(flight.controller);
    inflight.set(key, flight);
    flight.promise = runFlight(key, flight);
    return flight;
  }

  /** Wait for the flight; one waiter's abort never cancels the read while others still want it. */
  function waitFor(
    key: string,
    flight: Flight,
    signal: AbortSignal | undefined,
  ): Promise<Result<CacheEntry> | typeof ABORTED> {
    return new Promise((resolve) => {
      let settled = false;
      const onAbort = (): void => {
        if (settled || flight.done) return;
        settled = true;
        flight.waiters--;
        if (flight.waiters === 0) {
          flight.controller.abort();
          if (inflight.get(key) === flight) inflight.delete(key);
        }
        resolve(ABORTED);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void flight.promise.then((result) => {
        signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        resolve(result);
      });
    });
  }

  function grant(entry: CacheEntry, inert: boolean): Result<MediaHandle> {
    if (entry.opaque && !inert) return fail("unsupported-type");
    entries.delete(entry.key);
    entries.set(entry.key, entry);
    entry.refs++;
    return ok(handleFor(entry));
  }

  async function doAcquire(rawUrl: string, opts: AcquireOptions): Promise<Result<MediaHandle>> {
    const signal = opts.signal;
    if (purged) return fail("purged");
    if (signal?.aborted) return fail("aborted");
    const key = canonicalMediaUrl(rawUrl);
    if (key === undefined || !inScope(key) || !storage.isWithinStorage(key)) {
      return fail("out-of-scope");
    }
    const inert = opts.inert === true;
    const cached = entries.get(key);
    if (cached !== undefined) return grant(cached, inert);
    const flight = inflight.get(key) ?? startFlight(key, inert);
    flight.waiters++;
    if (inert) flight.inert = true;
    const result = await waitFor(key, flight, signal);
    if (result === ABORTED) return fail("aborted");
    if (!result.ok) return result;
    // The flight already counted this waiter's hold in `refs`.
    const entry = result.value;
    if (entry.revoked) return fail("purged");
    if (signal?.aborted) {
      releaseEntry(entry);
      return fail("aborted");
    }
    if (entry.opaque && !inert) {
      releaseEntry(entry);
      return fail("unsupported-type");
    }
    return ok(handleFor(entry));
  }

  async function doRevalidate(
    rawUrl: string,
    opts: { signal?: AbortSignal },
  ): Promise<Result<{ changed: boolean }>> {
    if (purged) return fail("purged");
    if (opts.signal?.aborted) return fail("aborted");
    const key = canonicalMediaUrl(rawUrl);
    if (key === undefined || !inScope(key) || !storage.isWithinStorage(key)) {
      return fail("out-of-scope");
    }
    const base = entries.get(key);
    if (base === undefined) return ok({ changed: false });
    if (base.etag === null) {
      retire(base);
      return ok({ changed: true });
    }
    const controller = new AbortController();
    const forward = (): void => controller.abort();
    opts.signal?.addEventListener("abort", forward, { once: true });
    active.add(controller);
    const readEpoch = epoch;
    try {
      const downloaded = await download(key, controller.signal, base.etag, () => base.opaque);
      if (downloaded === undefined || downloaded.etag === base.etag) return ok({ changed: false });
      if (purged || epoch !== readEpoch) return fail("purged");
      if (entries.get(key) !== base) return ok({ changed: true });
      place(createEntry(key, downloaded, 0));
      return ok({ changed: true });
    } catch (error) {
      const code = codeOfFailure(error, controller.signal, readEpoch);
      if (
        code === "not-found" ||
        code === "forbidden" ||
        code === "unsupported-type" ||
        code === "too-large"
      ) {
        if (entries.get(key) === base) retire(base);
      }
      return fail(code);
    } finally {
      active.delete(controller);
      opts.signal?.removeEventListener("abort", forward);
    }
  }

  return {
    async acquire(url, opts = {}) {
      try {
        return await doAcquire(url, opts);
      } catch {
        return fail("failed");
      }
    },

    async revalidate(url, opts = {}) {
      try {
        return await doRevalidate(url, opts);
      } catch {
        return fail("failed");
      }
    },

    invalidate(url) {
      const key = canonicalMediaUrl(url);
      if (key === undefined) return;
      const entry = entries.get(key);
      if (entry !== undefined) retire(entry);
      const flight = inflight.get(key);
      if (flight !== undefined) {
        flight.detached = true;
        inflight.delete(key);
      }
    },

    purge() {
      purged = true;
      epoch++;
      for (const controller of active) controller.abort();
      active.clear();
      inflight.clear();
      for (const entry of [...live]) revoke(entry);
      entries.clear();
    },

    resume() {
      purged = false;
    },

    stats() {
      return { entries: live.size, bytes: totalBytes, inFlight: inflight.size, purged };
    },
  };
}
