// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * `SolidDocStore` — the StorageClient adapter for {@link ./replication.js | replicateSolid}.
 *
 * It stores ONE pod resource per RxDB document under a single configured
 * container. Each document body is JSON by default (an envelope carrying the
 * document state + the replication bookkeeping the plugin needs — see
 * {@link ./replication.js}), or a consumer-supplied RDF serialisation via the
 * `toRdf`/`fromRdf` seam. A small per-collection METADATA resource holds the
 * plugin's monotonic write counter (so checkpoint ordering is total + stable).
 *
 * **Injectable authenticated fetch.** The store does NO crypto / DPoP itself —
 * the caller injects an already-authenticated `fetch` (e.g. from
 * `@solid/reactive-authentication` or a client-credentials DPoP fetch). This
 * keeps it a pure LDP client, like `@jeswr/solid-memory` / `@jeswr/y-solid`.
 *
 * **Scope guard on every op.** Every target URL is asserted to lie under
 * `container` (via `@jeswr/guarded-fetch`'s `assertWithinPodScope`, the suite's
 * consolidated pod-scope guard) before any request — defence in depth, so a
 * caller-supplied or server-listed URL can never make the store touch a
 * foreign origin or escape the container sub-tree. This is the SSRF backstop.
 * Write-target ops (this store mints documents strictly UNDER the container,
 * never at the container itself) pass `{ allowRoot: false }`; the one listing
 * op that may legitimately observe the container as its own member passes
 * `{ allowRoot: true }`.
 *
 * Listings and protocol details belong to StorageClient. Document payloads stay
 * opaque JSON or consumer-supplied RDF; this adapter never builds triples.
 */

import { assertWithinPodScope, isContainerUrl, normalizePodBase } from "@jeswr/guarded-fetch";
import {
  createPodClient,
  type StorageClient,
  StorageError,
  type WriteResult,
} from "@jeswr/storage-client";
import { readTextBounded, storageTransport } from "./transport.js";

/** Default media type a document resource is stored with (JSON storage mode). */
export const DOC_CONTENT_TYPE = "application/json";

/**
 * The reserved resource name for the per-collection metadata resource. It lives
 * in a NAMESPACE that {@link keyToResourceName} can never reach: a document
 * resource name is always `doc.<encoded>.json`, and the metadata name is exactly
 * `meta.json`, so the two can never collide. {@link listDocUrls} filters this
 * resource out so it is never surfaced as a document.
 */
export const META_RESOURCE_NAME = "meta.json";

/** A document read from the pod, with the headers the replication layer needs. */
export interface FetchedDoc {
  /** The raw stored body (text for JSON / RDF; bytes only if a consumer stores binary). */
  readonly body: string;
  /** The stored content type (so `fromRdf` can dispatch). */
  readonly contentType: string;
  /** The resource's ETag, if the server returned one. */
  readonly etag: string | null;
}

/** Options for {@link SolidDocStore} construction. */
export interface SolidDocStoreOptions {
  /** Absolute container URL the store owns (normalised to one trailing slash). */
  container: string;
  /** The (authenticated) fetch the store issues every request with. */
  fetch?: typeof globalThis.fetch;
  /** Use an existing client; its authenticated transport is retained. */
  storage?: StorageClient;
  /**
   * Hard cap (bytes) on any response body the store reads. A hostile / buggy
   * server cannot make the store allocate an unbounded buffer: a body that
   * exceeds this is refused (the stream is cancelled) rather than read into
   * memory. Default {@link DEFAULT_MAX_RESPONSE_BYTES}.
   */
  maxResponseBytes?: number;
}

/**
 * Default {@link SolidDocStoreOptions.maxResponseBytes} — 64 MiB. Generous for
 * a single JSON/RDF document while still bounding memory against a hostile
 * server that streams an endless body.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/**
 * Normalise a caller-supplied `maxResponseBytes` to a SAFE cap. An invalid
 * value (undefined, `NaN`, `Infinity`, non-positive, non-integer) must NEVER
 * silently DISABLE the cap — a `NaN` cap would make every `total > cap` check
 * `false` and read an unbounded body. So any invalid value falls back to
 * {@link DEFAULT_MAX_RESPONSE_BYTES} (mirroring `@jeswr/y-solid`). The cap is
 * therefore always a finite positive safe integer.
 */
export function resolveMaxResponseBytes(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return DEFAULT_MAX_RESPONSE_BYTES;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Key sanitisation — SSRF-critical, injective + reversible.
// ---------------------------------------------------------------------------

/**
 * The fixed prefix every DOCUMENT resource name carries, keeping document
 * resources in a namespace disjoint from {@link META_RESOURCE_NAME}.
 */
const DOC_PREFIX = "doc.";
/** The fixed suffix every document resource name carries. */
const DOC_SUFFIX = ".json";

/**
 * Encode an arbitrary consumer-controlled primary key into a SAFE in-container
 * resource name.
 *
 * **Scheme (deterministic, INJECTIVE, REVERSIBLE):** percent-encode EVERY byte
 * of the UTF-8 key that is not in the unreserved set `[A-Za-z0-9_-]`, using a
 * fixed two-hex-digit uppercase escape (`_`-introduced rather than `%` so the
 * result contains no URL-significant or percent-decodable characters at all),
 * then wrap it as `doc.<encoded>.json`.
 *
 * Concretely we escape any byte outside `[A-Za-z0-9-]` (note: `_` is the escape
 * introducer, so a literal `_` in the key is ALSO escaped — keeping the encoding
 * unambiguous and reversible). The output alphabet is therefore strictly
 * `[A-Za-z0-9-]` plus the `_` escape introducer plus the literal `doc.`/`.json`
 * affixes — containing NO `/`, NO `.` runs (`..`), NO `%`, NO whitespace, NO
 * control bytes, and nothing the WHATWG URL parser will normalise. As a result
 * `container + keyToResourceName(key)` is ALWAYS a strict descendant of the
 * container for ANY key, so `assertWithinPodScope` can never throw on it —
 * traversal is made structurally impossible, with the scope guard as the
 * defence-in-depth backstop.
 *
 * Injectivity: the encode is a byte-for-byte total function on the UTF-8 octets
 * with a single unambiguous escape, and the affixes are fixed, so distinct keys
 * always map to distinct names (no collisions, including with
 * {@link META_RESOURCE_NAME}).
 */
export function keyToResourceName(key: string): string {
  const bytes = new TextEncoder().encode(key);
  let out = "";
  for (const b of bytes) {
    // Unreserved, escape-introducer-free alphabet: A-Z a-z 0-9 '-'.
    const isUpper = b >= 0x41 && b <= 0x5a;
    const isLower = b >= 0x61 && b <= 0x7a;
    const isDigit = b >= 0x30 && b <= 0x39;
    const isDash = b === 0x2d; // '-'
    if (isUpper || isLower || isDigit || isDash) {
      out += String.fromCharCode(b);
    } else {
      // `_` + two uppercase hex digits. `_` itself (0x5f) lands here, so it is
      // escaped too — the encoding is unambiguous and round-trips.
      out += `_${b.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return `${DOC_PREFIX}${out}${DOC_SUFFIX}`;
}

/**
 * The inverse of {@link keyToResourceName}: decode a document resource name back
 * to its original primary key. Throws if `name` is not a well-formed document
 * resource name produced by {@link keyToResourceName} (so a foreign / malformed
 * listing entry is rejected, never silently mis-decoded).
 */
export function resourceNameToKey(name: string): string {
  if (!name.startsWith(DOC_PREFIX) || !name.endsWith(DOC_SUFFIX)) {
    throw new Error(`[rxdb-solid] not a document resource name: ${name}`);
  }
  const body = name.slice(DOC_PREFIX.length, name.length - DOC_SUFFIX.length);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === "_") {
      const hex = body.slice(i + 1, i + 3);
      if (hex.length !== 2 || !/^[0-9A-F]{2}$/.test(hex)) {
        throw new Error(`[rxdb-solid] malformed escape in resource name: ${name}`);
      }
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      const code = ch.charCodeAt(0);
      // Only the unreserved alphabet is valid OUTSIDE an escape.
      const ok =
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        (code >= 0x30 && code <= 0x39) ||
        code === 0x2d;
      if (!ok) {
        throw new Error(`[rxdb-solid] unexpected character in resource name: ${name}`);
      }
      bytes.push(code);
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

/** True iff `name` is the metadata resource name (never a document). */
function isMetaName(name: string): boolean {
  return name === META_RESOURCE_NAME;
}

/**
 * The per-document/per-collection LDP store under one container.
 *
 * Construct with an absolute container URL + an authenticated fetch. The
 * constructor rejects a non-http(s) container and normalises it to a single
 * trailing slash.
 */
export class SolidDocStore {
  /** The normalised container URL (one trailing slash). */
  readonly container: string;
  private readonly storage: () => Promise<StorageClient>;
  private readonly maxResponseBytes: number;

  constructor(options: SolidDocStoreOptions) {
    // normalizePodBase throws on a non-http(s) / non-absolute container.
    this.container = normalizePodBase(options.container);
    // Never let an invalid cap (NaN/Infinity/non-positive/non-integer) silently
    // DISABLE the byte limit — an invalid value falls back to the default.
    this.maxResponseBytes = resolveMaxResponseBytes(options.maxResponseBytes);
    if (!options.storage && typeof options.fetch !== "function") {
      throw new TypeError("[rxdb-solid] pass storage or an authenticated fetch");
    }
    let pending: Promise<StorageClient> | undefined;
    let discovering = true;
    this.storage = () => {
      if (options.storage) return Promise.resolve(options.storage);
      pending ??= createPodClient({
        storage: this.container,
        fetch: storageTransport(
          this.container,
          options.fetch as typeof fetch,
          this.maxResponseBytes,
          () => discovering,
        ),
      })
        .then(({ storage }) => {
          discovering = false;
          return storage;
        })
        .catch((error: unknown) => {
          pending = undefined;
          discovering = true;
          throw storageCause(error);
        });
      return pending;
    };
  }

  /** The absolute URL of the resource named `resourceName` under the container. */
  resourceUrl(resourceName: string): string {
    const url = `${this.container}${resourceName}`;
    // Write-target semantics: the container root itself is never a managed
    // resource, so it is refused here (allowRoot: false).
    assertWithinPodScope(this.container, url, { allowRoot: false });
    return url;
  }

  /** The absolute URL a primary `key` maps to (its sanitised document resource). */
  docUrl(key: string): string {
    return this.resourceUrl(keyToResourceName(key));
  }

  /**
   * Overwrite-capable PUT of `body` to `${container}${resourceName}` with the
   * given content type.
   *
   * **Concurrency control via an optional precondition.** Pass `ifMatch` to
   * write only if the resource's current ETag matches (an OPTIMISTIC update), or
   * `ifNoneMatch: "*"` to write only if the resource does NOT yet exist (an
   * atomic CREATE). When the server rejects the precondition (HTTP 412), this
   * returns `{ ok: false, precondition: "failed" }` rather than throwing, so the
   * caller can re-read + reconcile (the lost-update / conflict path). With no
   * precondition it is a plain overwrite.
   *
   * On success returns `{ ok: true, url, etag }` (the new ETag if reported).
   *
   * @throws if the target is outside the container, or on a non-ok response that
   *   is NOT a precondition failure.
   */
  async putDoc(
    resourceName: string,
    body: string,
    contentType: string,
    opts?: { ifMatch?: string; ifNoneMatch?: string },
  ): Promise<
    { ok: true; url: string; etag: string | null } | { ok: false; precondition: "failed" }
  > {
    const url = this.resourceUrl(resourceName);
    try {
      const storage = await this.storage();
      let result: WriteResult;
      if (opts?.ifNoneMatch) {
        if (opts.ifNoneMatch !== "*" || opts.ifMatch) {
          throw new TypeError("[rxdb-solid] create requires only ifNoneMatch: '*'");
        }
        if (storage.protocol === "lws") {
          try {
            await storage.head(url);
            return { ok: false, precondition: "failed" };
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
        result = await storage.create(this.container, body, { name: resourceName, contentType });
      } else if (storage.protocol === "lws" && !opts?.ifMatch) {
        try {
          await storage.head(url);
          result = await storage.write(url, body, { contentType, ifMatch: "*" });
        } catch (error) {
          if (!isMissing(error)) throw error;
          result = await storage.create(this.container, body, { name: resourceName, contentType });
        }
      } else {
        result = await storage.write(url, body, { contentType, ifMatch: opts?.ifMatch || "*" });
      }
      // This adapter's persisted index uses stable resource names. Do not silently
      // acknowledge a server-chosen identifier that the next pull cannot resolve.
      if (result.url !== url)
        throw new Error("[rxdb-solid] storage did not preserve the document name");
      return { ok: true, url: result.url, etag: result.etag };
    } catch (error) {
      if (
        error instanceof StorageError &&
        (error.status === 412 ||
          error.status === 428 ||
          // A generic conflict can mean a missing parent, not a concurrent create.
          // Confirm the target exists before asking RxDB to reconcile master state.
          (opts?.ifNoneMatch === "*" &&
            error.code === "conflict" &&
            (await this.getDoc(resourceName)) !== null))
      ) {
        return { ok: false, precondition: "failed" };
      }
      throw storageCause(error);
    }
  }

  /**
   * GET a single resource. Returns `null` for a missing resource (404/410).
   *
   * @throws if the target is outside the container, or on any other non-ok
   *   response.
   */
  async getDoc(resourceName: string): Promise<FetchedDoc | null> {
    const url = this.resourceUrl(resourceName);
    try {
      const result = await (await this.storage()).read(url, {
        accept: "application/json, text/turtle, application/ld+json;q=0.9, */*;q=0.1",
      });
      const body = await readTextBounded(
        { body: result.body, headers: new Headers(), text: () => result.text() } as Response,
        this.maxResponseBytes,
        url,
      );
      return { body, contentType: result.contentType ?? DOC_CONTENT_TYPE, etag: result.etag };
    } catch (error) {
      if (isMissing(error)) return null;
      throw storageCause(error);
    }
  }

  /**
   * DELETE a single resource. A missing resource (404/410) is treated as
   * already-deleted (no throw) — the default replication path uses TOMBSTONES
   * (a `_deleted` write) rather than a hard DELETE, so this is only the explicit
   * GC seam.
   *
   * @throws if the target is outside the container, or on any other non-ok
   *   response.
   */
  async deleteDoc(resourceName: string): Promise<void> {
    const url = this.resourceUrl(resourceName);
    try {
      const storage = await this.storage();
      const current = await storage.head(url).catch((error: unknown) => {
        if (error instanceof StorageError && error.status === 405) return storage.read(url);
        throw error;
      });
      await current.body?.cancel();
      if (!current.etag) throw new Error("[rxdb-solid] cannot delete a resource without an ETag");
      await storage.delete(url, { ifMatch: current.etag });
    } catch (error) {
      if (!isMissing(error)) throw storageCause(error);
    }
  }

  /**
   * List the direct `ldp:contains` members of the container that are DOCUMENT
   * resources. Returns an empty array for a missing container (404/410). Each
   * member is scope-guarded against the container — a foreign-origin / escaping
   * member listed by a hostile or buggy server is skipped, never surfaced. Sub-
   * containers (trailing slash), the per-collection metadata resource, and any
   * member that is not a well-formed document resource name are skipped. The
   * result is sorted by URL (lexicographic) — deterministic order.
   *
   * @throws on any non-ok, non-404/410 response.
   */
  async listDocUrls(): Promise<string[]> {
    const urls: string[] = [];
    let receivedEntry = false;
    try {
      const storage = await this.storage();
      for await (const entry of storage.listAll(this.container)) {
        receivedEntry = true;
        const absolute = entry.url;
        if (entry.kind === "container" || isContainerUrl(absolute)) continue;
        try {
          assertWithinPodScope(this.container, absolute, { allowRoot: false });
        } catch {
          continue;
        }
        const name = absolute.slice(this.container.length);
        if (
          name.includes("/") ||
          isMetaName(name) ||
          !name.startsWith(DOC_PREFIX) ||
          !name.endsWith(DOC_SUFFIX)
        )
          continue;
        urls.push(absolute);
      }
    } catch (error) {
      if (
        receivedEntry ||
        !(error instanceof StorageError) ||
        !(
          (isMissing(error) && error.url === this.container) ||
          (error.code === "method-not-allowed" && error.status === null)
        )
      )
        throw storageCause(error);
    }
    return urls.sort();
  }

  /**
   * Map an absolute (or container-relative) document resource URL back to its
   * bare resource name (the segment after the container). Throws if the URL is
   * not a direct child of the container.
   */
  urlToResourceName(url: string): string {
    const absolute = new URL(url, this.container).toString();
    // Write-target semantics: same as resourceUrl (allowRoot: false).
    assertWithinPodScope(this.container, absolute, { allowRoot: false });
    const name = absolute.slice(this.container.length);
    if (name.length === 0 || name.includes("/")) {
      throw new Error(`[rxdb-solid] ${url} is not a direct child resource of the container`);
    }
    return name;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof StorageError && (error.status === 404 || error.status === 410);
}

/** Retain transport guard errors through the SDK's network error wrapper. */
function storageCause(error: unknown): unknown {
  return error instanceof StorageError && error.code === "network" && error.cause
    ? error.cause
    : error;
}
