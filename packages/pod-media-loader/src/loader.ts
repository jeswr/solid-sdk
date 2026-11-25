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
import { type ReadBody, raceAbort, readBounded } from "./read.js";
import { defaultSniff, type Sniffer } from "./sniff.js";
import { canonicalMediaUrl, type MediaScope, scopeTest } from "./url.js";
import { chunksView, prefixOf } from "./view.js";

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

/** Default `maxPixels`: 64 megapixels. Raise it explicitly if you need more. */
export const DEFAULT_MAX_PIXELS = 64_000_000;
export const DEFAULT_MAX_CONCURRENT = 6;
export const DEFAULT_READ_TIMEOUT_MS = 120_000;
/** The sniffer is handed at most this many leading bytes (plus the full size). */
export const SNIFF_WINDOW = 64 * 1024;

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
  /**
   * Hard budget for cached + held + in-flight bytes. Each read reserves `maxBytes` up front; an
   * acquire that cannot fit after evicting unreferenced entries fails with `over-budget`.
   */
  maxTotalBytes: number;
  /** Hard budget for live object URLs plus reads in flight. */
  maxEntries: number;
  /** Refuse images whose header declares more pixels than this. Default 64 megapixels. */
  maxPixels?: number;
  /** Reads running at once; the rest wait in a FIFO queue that honours abort. Default 6. */
  maxConcurrent?: number;
  /** Total time one read may take before it is abandoned as `offline`. Default 120 000 ms. */
  readTimeoutMs?: number;
  /**
   * Identifies who the cache belongs to (for example the WebID). Checked on every call; when it
   * changes everything is purged before anything can be served. Default: one constant session.
   */
  getSessionKey?: () => string;
  /** Replace the magic-byte sniffer. It gets the first 64 KiB and the full size. */
  sniff?: Sniffer;
  /** Replace the allowlist of sniffed content types. Active types are refused at creation. */
  allow?: readonly string[];
  /** Inject `URL.createObjectURL` / `URL.revokeObjectURL` (tests, non-browser hosts). */
  objectUrls?: ObjectUrlApi;
}

export interface AcquireOptions {
  signal?: AbortSignal;
  /**
   * Download-only use. Never fails for type or pixel reasons: anything that is not allowed
   * media, or is over `maxPixels`, comes back as `application/octet-stream`. Byte, budget and
   * scope limits still apply.
   */
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
  /**
   * Called synchronously whenever every object URL has been revoked (`purge()` or a session
   * change). Returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
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
  timedOut: boolean;
}

interface Downloaded extends ReadBody {
  readonly contentType: string;
  readonly opaque: boolean;
  readonly etag: string | null;
}

/** A read's slot in the concurrency queue plus its byte and entry reservation. */
interface Permit {
  release(): void;
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

/** An AbortSignal from any realm, without trusting its prototype. */
function isSignal(value: unknown): value is AbortSignal {
  const signal = value as Partial<AbortSignal> | null;
  return (
    typeof signal === "object" &&
    signal !== null &&
    typeof signal.aborted === "boolean" &&
    typeof signal.addEventListener === "function" &&
    typeof signal.removeEventListener === "function"
  );
}

export function createMediaLoader(options: MediaLoaderOptions): MediaLoader {
  const { storage } = options;
  const maxEntries = positiveInteger("maxEntries", options.maxEntries);
  const maxTotalBytes = positiveInteger("maxTotalBytes", options.maxTotalBytes);
  const maxBytes = Math.min(positiveInteger("maxBytes", options.maxBytes), maxTotalBytes);
  const maxPixels = positiveInteger("maxPixels", options.maxPixels ?? DEFAULT_MAX_PIXELS);
  const maxConcurrent = positiveInteger(
    "maxConcurrent",
    options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
  );
  const readTimeoutMs = positiveInteger(
    "readTimeoutMs",
    options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
  );
  const getSessionKey = options.getSessionKey ?? ((): string => "");
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
  const listeners = new Set<() => void>();
  /** URLs whose next read must bypass the HTTP cache (after `invalidate`). */
  const stale = new Set<string>();
  const queue: { grant(): void }[] = [];
  let running = 0;
  let reservedBytes = 0;
  let reservedCount = 0;
  let totalBytes = 0;
  let epoch = 0;
  let purged = false;
  let sessionKey: string | undefined;

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

  /** The least recently used entry nobody holds. */
  function unreferenced(): CacheEntry | undefined {
    for (const candidate of entries.values()) if (candidate.refs === 0) return candidate;
    return undefined;
  }

  function releaseEntry(entry: CacheEntry): void {
    entry.refs--;
    if (entry.revoked || entry.refs > 0) return;
    // A current entry stays cached (and evictable); a superseded one has no further use.
    if (entries.get(entry.key) !== entry) revoke(entry);
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
    const blob = new Blob(d.chunks as BlobPart[], { type: d.contentType });
    const entry: CacheEntry = {
      key,
      objectUrl: urls.createObjectURL(blob),
      contentType: d.contentType,
      size: d.size,
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
    stale.delete(entry.key);
  }

  // ---- admission: concurrency queue and hard budget ----

  function releaseSlot(): void {
    running--;
    queue.shift()?.grant();
  }

  function acquireSlot(signal: AbortSignal): Promise<void> {
    if (running < maxConcurrent) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = {
        grant(): void {
          signal.removeEventListener("abort", onAbort);
          running++;
          resolve();
        },
      };
      const onAbort = (): void => {
        queue.splice(queue.indexOf(waiter), 1);
        reject(new MediaFailure("aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      queue.push(waiter);
    });
  }

  /** A slot and a reservation of `maxBytes` and one entry, evicting unreferenced entries to fit. */
  async function admit(signal: AbortSignal): Promise<Permit> {
    await acquireSlot(signal);
    const fits = (): boolean =>
      totalBytes + reservedBytes + maxBytes <= maxTotalBytes &&
      live.size + reservedCount + 1 <= maxEntries;
    while (!fits()) {
      const victim = unreferenced();
      if (victim === undefined) {
        releaseSlot();
        throw new MediaFailure("over-budget");
      }
      revoke(victim);
    }
    reservedBytes += maxBytes;
    reservedCount++;
    let released = false;
    return {
      release(): void {
        if (released) return;
        released = true;
        reservedBytes -= maxBytes;
        reservedCount--;
        releaseSlot();
      },
    };
  }

  // ---- reading ----

  /** The type decision, from magic bytes only. Inert callers never fail for type or pixels. */
  function classify(
    body: ReadBody,
    inert: boolean,
  ): { contentType: string; opaque: boolean } | MediaErrorCode {
    const refuse = (
      code: MediaErrorCode,
    ): { contentType: string; opaque: boolean } | MediaErrorCode =>
      inert ? { contentType: INERT_TYPE, opaque: true } : code;
    const sniffed = sniff(prefixOf(body.chunks, SNIFF_WINDOW), body.size);
    if (sniffed === undefined || !allowed.has(sniffed.contentType)) {
      return refuse("unsupported-type");
    }
    const { contentType } = sniffed;
    if (contentType.startsWith("image/")) {
      const size = imageDimensions(contentType, chunksView(body.chunks));
      if (size === undefined || size.width < 1 || size.height < 1) {
        return refuse("unsupported-type");
      }
      if (size.width * size.height > maxPixels) return refuse("too-large");
    }
    return { contentType, opaque: false };
  }

  /** One bounded, scoped read. Throws `MediaFailure` or a storage error; `undefined` is a 304. */
  async function download(
    key: string,
    signal: AbortSignal,
    ifNoneMatch: string | undefined,
    inert: () => boolean,
    fresh: boolean,
  ): Promise<Downloaded | undefined> {
    const result = await raceAbort(
      storage.read(key, {
        signal,
        ...(ifNoneMatch === undefined ? {} : { ifNoneMatch }),
        // The storage client has no cache option on `read`; a request-level Cache-Control makes
        // the browser's fetch bypass its HTTP cache for this read.
        ...(fresh ? { headers: { "Cache-Control": "no-cache" } } : {}),
      }),
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
    const body = await readBounded(result.body, maxBytes, signal);
    const decided = classify(body, inert());
    if (typeof decided === "string") throw new MediaFailure(decided);
    return { ...body, ...decided, etag: result.etag };
  }

  /** The closed code for anything thrown while a read of this epoch was running. */
  function codeOfFailure(
    error: unknown,
    signal: AbortSignal,
    readEpoch: number,
    timedOut: boolean,
  ): MediaErrorCode {
    if (purged || epoch !== readEpoch) return "purged";
    if (timedOut) return "offline";
    if (signal.aborted) return "aborted";
    return error instanceof MediaFailure ? error.code : codeOfStorageError(error);
  }

  async function runFlight(key: string, flight: Flight): Promise<Result<CacheEntry>> {
    const { signal } = flight.controller;
    const timer = setTimeout(() => {
      flight.timedOut = true;
      flight.controller.abort();
    }, readTimeoutMs);
    let permit: Permit | undefined;
    let outcome: Result<CacheEntry>;
    try {
      permit = await admit(signal);
      const downloaded = (await download(
        key,
        signal,
        undefined,
        () => flight.inert,
        stale.has(key),
      )) as Downloaded;
      // From here to the object URL nothing awaits: the purge guard cannot be overtaken.
      if (purged || epoch !== flight.epoch) throw new MediaFailure("purged");
      // Every waiter left (or the read timed out) as the last bytes arrived: create nothing.
      if (signal.aborted) throw new MediaFailure("aborted");
      // Waiter aborts after this point cannot change the count that `refs` takes.
      flight.done = true;
      permit.release();
      const entry = createEntry(key, downloaded, flight.waiters);
      if (!flight.detached) place(entry);
      outcome = ok(entry);
    } catch (error) {
      outcome = fail(codeOfFailure(error, signal, flight.epoch, flight.timedOut));
    } finally {
      clearTimeout(timer);
      permit?.release();
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
      timedOut: false,
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

  /** Revoke everything and abort every read; the loader keeps working afterwards. */
  function teardown(): void {
    epoch++;
    for (const controller of active) controller.abort();
    active.clear();
    inflight.clear();
    stale.clear();
    for (const entry of [...live]) revoke(entry);
    entries.clear();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // One failing listener must not stop the others or the purge.
      }
    }
  }

  /** A changed session key purges everything before anything can be served. */
  function checkSession(): void {
    const key = String(getSessionKey());
    if (sessionKey !== undefined && key !== sessionKey) teardown();
    sessionKey = key;
  }

  /** Common front door: state, argument and scope checks. A `Result` means refuse. */
  function admitCall(
    rawUrl: string,
    signal: AbortSignal | undefined,
  ): { key: string } | Result<never> {
    if (purged) return fail("purged");
    if (signal !== undefined && !isSignal(signal)) return fail("failed");
    checkSession();
    if (signal?.aborted) return fail("aborted");
    const key = canonicalMediaUrl(rawUrl);
    if (key === undefined || !inScope(key) || !storage.isWithinStorage(key)) {
      return fail("out-of-scope");
    }
    return { key };
  }

  async function doAcquire(
    rawUrl: string,
    opts: AcquireOptions,
    retried = false,
  ): Promise<Result<MediaHandle>> {
    const { signal } = opts;
    const front = admitCall(rawUrl, signal);
    if ("ok" in front) return front;
    const { key } = front;
    const inert = opts.inert === true;
    const cached = entries.get(key);
    if (cached !== undefined) return grant(cached, inert);
    const flight = inflight.get(key) ?? startFlight(key, inert);
    flight.waiters++;
    if (inert) flight.inert = true;
    const result = await waitFor(key, flight, signal);
    if (result === ABORTED) return fail("aborted");
    if (!result.ok) {
      // A strict flight may have refused the type just before this inert caller joined it:
      // inert callers never fail for type or pixels, so read again, as inert.
      const { code } = result.error;
      if (inert && !retried && (code === "unsupported-type" || code === "too-large")) {
        return doAcquire(rawUrl, opts, true);
      }
      return result;
    }
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
    const front = admitCall(rawUrl, opts.signal);
    if ("ok" in front) return front;
    const { key } = front;
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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, readTimeoutMs);
    const readEpoch = epoch;
    let permit: Permit | undefined;
    try {
      permit = await admit(controller.signal);
      const downloaded = await download(key, controller.signal, base.etag, () => base.opaque, true);
      if (purged || epoch !== readEpoch) return fail("purged");
      if (downloaded === undefined || downloaded.etag === base.etag) return ok({ changed: false });
      if (entries.get(key) !== base) return ok({ changed: true });
      permit.release();
      place(createEntry(key, downloaded, 0));
      return ok({ changed: true });
    } catch (error) {
      const code = codeOfFailure(error, controller.signal, readEpoch, timedOut);
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
      clearTimeout(timer);
      permit?.release();
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
      // Whatever is read next must come from the pod, not from the HTTP cache.
      stale.add(key);
    },

    purge() {
      purged = true;
      teardown();
    },

    resume() {
      purged = false;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    stats() {
      return { entries: live.size, bytes: totalBytes, inFlight: inflight.size, purged };
    },
  };
}
