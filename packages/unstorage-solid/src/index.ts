// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/unstorage-solid` — an {@link https://unstorage.unjs.io | unstorage}
 * `defineDriver()` driver that backs unstorage's KV API with a
 * {@link https://solidproject.org | Solid} pod over LDP.
 *
 * unstorage keys map to LDP resource paths under a fixed `base` container; stored
 * VALUES are opaque KV blobs (text / JSON / binary) and are never RDF-parsed. The
 * ONLY RDF the driver touches is the container listing used by `getKeys` /
 * `clear`, parsed via `@jeswr/fetch-rdf` + `@solid/object` (never hand-built).
 *
 * Authentication is injected: pass a (DPoP-bound) authenticated `fetch` — e.g. a
 * browser Solid session's `fetch`, or a Node client-credentials fetch from
 * `@jeswr/solid-dpop`. With no `fetch` the global `fetch` is used (only public
 * resources will work).
 *
 * @packageDocumentation
 */

import type { Driver, StorageMeta, StorageValue, WatchCallback } from "unstorage";
import { defineDriver } from "unstorage";
import { listContainer } from "./container.js";
import { assertWithinBase, keyToContainerUrl, keyToUrl, normalizeBase, urlToKey } from "./keys.js";
import { type ActiveWatch, startWatch, type WatchSocketFactory } from "./watch.js";

const DRIVER_NAME = "solid";

/** Configuration for the Solid unstorage driver. */
export interface SolidDriverOptions {
  /**
   * Base container URL the driver reads/writes under, e.g.
   * `https://alice.pod.example/unstorage/`. Normalised to exactly one trailing
   * slash. Keys are mapped to LDP resource paths beneath this container and can
   * never escape it (see the key-mapping rules in the README).
   */
  base: string;
  /**
   * The `fetch` implementation. Pass an authenticated Solid `fetch` for protected
   * pods. Defaults to the global `fetch`.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Extra request headers merged into every request (e.g. a custom auth header).
   * Per-transaction `opts.headers` override these.
   */
  headers?: Record<string, string>;
  /**
   * Content-Type used for `setItem` (string values) when no per-call content-type
   * is given. Defaults to `text/plain; charset=utf-8`.
   */
  defaultContentType?: string;
  /**
   * Enable live `watch()` via Solid Notifications (WebSocketChannel2023). When
   * `false` (default), `watch()` is a graceful no-op. Watch always degrades
   * gracefully when the pod advertises no notification channel.
   */
  watch?: boolean;
  /**
   * Internal/testing seam: build a WebSocket from a `wss://` URL. Defaults to the
   * global `WebSocket`. Not part of the stable public contract.
   * @internal
   */
  wsFactory?: WatchSocketFactory;
  /**
   * Internal/testing seam: a logger invoked when `watch()` degrades. Defaults to
   * a no-op.
   * @internal
   */
  onWatchDegrade?: (reason: string) => void;
}

/** Per-call transaction options understood by this driver (a superset is allowed). */
interface SolidTransactionOptions {
  /** Extra request headers for this call (override driver `headers`). */
  headers?: Record<string, string>;
  /** Content-Type to PUT with (overrides `defaultContentType`). */
  contentType?: string;
  /**
   * Optimistic-concurrency ETag. When present, sent as `If-Match` on a write so a
   * stale write is rejected (HTTP 412) by the server. Read it from `getMeta().etag`.
   */
  etag?: string;
}

/** A precondition-failed (HTTP 412 / optimistic-concurrency) error. */
export class SolidPreconditionFailedError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`[unstorage-solid] precondition failed (If-Match) for ${url}: ${status}`);
    this.name = "SolidPreconditionFailedError";
    this.url = url;
    this.status = status;
  }
}

/** A non-success HTTP response the driver could not interpret as success/absence. */
export class SolidHttpError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(method: string, url: string, status: number, statusText: string) {
    super(`[unstorage-solid] ${method} ${url} failed: ${status} ${statusText}`);
    this.name = "SolidHttpError";
    this.url = url;
    this.status = status;
  }
}

function buildHeaders(
  driverHeaders: Record<string, string> | undefined,
  txHeaders: Record<string, string> | undefined,
  extra?: Record<string, string>,
): Record<string, string> {
  return { ...driverHeaders, ...extra, ...txHeaders };
}

function asTx(opts: unknown): SolidTransactionOptions {
  return (opts && typeof opts === "object" ? opts : {}) as SolidTransactionOptions;
}

/**
 * Normalise unstorage's `relativeBase` (the prefix passed to getKeys/clear) into
 * a driver key prefix. unstorage hands a normalised colon-delimited key with a
 * TRAILING `:` (e.g. `"dir:"` for prefix `dir`), or `null`/`undefined`/`""` for
 * the whole mount. Returns the prefix key WITHOUT the trailing colon, or
 * `undefined` when no prefix (the whole mount).
 */
function relativePrefixKey(base_: string | null | undefined): string | undefined {
  if (typeof base_ !== "string" || base_.length === 0) {
    return undefined;
  }
  const stripped = base_.endsWith(":") ? base_.slice(0, -1) : base_;
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * The Solid unstorage driver. Mount it with unstorage's `createStorage`:
 *
 * ```ts
 * import { createStorage } from "unstorage";
 * import solidDriver from "@jeswr/unstorage-solid";
 * const storage = createStorage({
 *   driver: solidDriver({ base: "https://alice.pod.example/kv/", fetch: session.fetch }),
 * });
 * ```
 */
const solidDriver = defineDriver<SolidDriverOptions, undefined>((options) => {
  if (!options || typeof options.base !== "string" || options.base.length === 0) {
    throw new Error("[unstorage-solid] `base` option is required");
  }
  const base = normalizeBase(options.base);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("[unstorage-solid] no `fetch` available (pass `fetch` in options)");
  }
  const defaultContentType = options.defaultContentType ?? "text/plain; charset=utf-8";
  const watchEnabled = options.watch === true;

  // Track open watches so dispose() can close them.
  const activeWatches = new Set<ActiveWatch>();

  const doFetch = (url: string, init: RequestInit): Promise<Response> => {
    // Defence in depth: every URL we issue a request to must lie under base.
    assertWithinBase(base, url);
    return fetchImpl(url, init);
  };

  /**
   * Ensure the parent containers of `resourceUrl` exist, creating any missing
   * ones with a `PUT` + `Link: <ldp#BasicContainer>; rel="type"`. CSS auto-creates
   * intermediate containers on a deep PUT; ESS historically did not — so we create
   * them explicitly, top-down, idempotently (an existing container PUT is a no-op
   * 2xx/205 on CSS; a 4xx that is not "exists" is surfaced).
   */
  const ensureParentContainers = async (
    resourceUrl: string,
    headers: Record<string, string>,
  ): Promise<void> => {
    const u = new URL(resourceUrl);
    const baseUrl = new URL(base);
    // The path segments between base and the resource's own name are containers.
    const rel = u.pathname.slice(baseUrl.pathname.length);
    const parts = rel.split("/").filter((s) => s.length > 0);
    // Drop the last part (the resource itself).
    parts.pop();
    let current = base;
    for (const part of parts) {
      current = `${current}${part}/`;
      const res = await doFetch(current, {
        method: "PUT",
        headers: {
          ...headers,
          "content-type": "text/turtle",
          link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
        },
      });
      // 2xx = created/updated; 409/412 can mean "already exists" on some servers;
      // 405 can mean the container path is fixed. Tolerate those, surface the rest.
      if (!res.ok && res.status !== 409 && res.status !== 412 && res.status !== 405) {
        throw new SolidHttpError("PUT", current, res.status, res.statusText);
      }
    }
  };

  const putResource = async (
    url: string,
    body: BodyInit,
    contentType: string,
    tx: SolidTransactionOptions,
  ): Promise<void> => {
    const headers = buildHeaders(options.headers, tx.headers, { "content-type": contentType });
    if (tx.etag) {
      headers["if-match"] = tx.etag;
    }
    let res = await doFetch(url, { method: "PUT", headers, body });
    if (res.status === 412 || res.status === 428) {
      // Precondition failed (optimistic concurrency) — surface, do not retry.
      throw new SolidPreconditionFailedError(url, res.status);
    }
    // A missing parent container surfaces as 404/409 on some servers. Create the
    // ancestors then retry ONCE. (We only do this when no If-Match is set, so a
    // concurrency rejection is never masked by a container-create retry.)
    if ((res.status === 404 || res.status === 409) && !tx.etag) {
      await ensureParentContainers(url, buildHeaders(options.headers, tx.headers));
      res = await doFetch(url, { method: "PUT", headers, body });
    }
    if (!res.ok) {
      throw new SolidHttpError("PUT", url, res.status, res.statusText);
    }
  };

  const driver: Driver<SolidDriverOptions, undefined> = {
    name: DRIVER_NAME,
    options,
    flags: { maxDepth: true },

    async hasItem(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      let res = await doFetch(url, { method: "HEAD", headers });
      // Some pods do not support HEAD on resources (405) — fall back to GET.
      if (res.status === 405) {
        res = await doFetch(url, { method: "GET", headers });
      }
      if (res.status === 404 || res.status === 410) {
        return false;
      }
      if (!res.ok) {
        throw new SolidHttpError("HEAD", url, res.status, res.statusText);
      }
      return true;
    },

    async getItem(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      const res = await doFetch(url, { method: "GET", headers });
      if (res.status === 404 || res.status === 410) {
        return null;
      }
      if (!res.ok) {
        throw new SolidHttpError("GET", url, res.status, res.statusText);
      }
      // Return the raw text body; unstorage's Storage layer applies destr() to
      // parse JSON/number/boolean for the caller.
      return (await res.text()) as StorageValue;
    },

    async getItemRaw(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers, {
        accept: "application/octet-stream",
      });
      const res = await doFetch(url, { method: "GET", headers });
      if (res.status === 404 || res.status === 410) {
        return null;
      }
      if (!res.ok) {
        throw new SolidHttpError("GET", url, res.status, res.statusText);
      }
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    },

    async setItem(key, value, opts) {
      const tx = asTx(opts);
      const url = keyToUrl(base, key);
      await putResource(url, value, tx.contentType ?? defaultContentType, tx);
    },

    async setItemRaw(key, value, opts) {
      const tx = asTx(opts);
      const url = keyToUrl(base, key);
      const body = toBodyInit(value);
      await putResource(url, body, tx.contentType ?? "application/octet-stream", tx);
    },

    async removeItem(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      const res = await doFetch(url, { method: "DELETE", headers });
      // DELETE is idempotent: a 404/410 means already gone — success.
      if (res.ok || res.status === 404 || res.status === 410) {
        return;
      }
      throw new SolidHttpError("DELETE", url, res.status, res.statusText);
    },

    async getMeta(key, opts) {
      const url = keyToUrl(base, key);
      const headers = buildHeaders(options.headers, asTx(opts).headers);
      let res = await doFetch(url, { method: "HEAD", headers });
      if (res.status === 405) {
        res = await doFetch(url, { method: "GET", headers });
      }
      if (res.status === 404 || res.status === 410) {
        return null;
      }
      if (!res.ok) {
        throw new SolidHttpError("HEAD", url, res.status, res.statusText);
      }
      const meta: StorageMeta = { status: res.status };
      const lastModified = res.headers.get("last-modified");
      if (lastModified) {
        const d = new Date(lastModified);
        if (!Number.isNaN(d.getTime())) {
          meta.mtime = d;
        }
      }
      const length = res.headers.get("content-length");
      if (length !== null && length !== "") {
        const n = Number(length);
        if (Number.isFinite(n)) {
          meta.size = n;
        }
      }
      const etag = res.headers.get("etag");
      if (etag) {
        meta.etag = etag;
      }
      const contentType = res.headers.get("content-type");
      if (contentType) {
        meta.mimeType = contentType;
      }
      return meta;
    },

    async getKeys(base_, opts) {
      const maxDepth =
        typeof opts?.maxDepth === "number" ? opts.maxDepth : Number.POSITIVE_INFINITY;
      // `base_` is unstorage's `relativeBase`: a normalised colon-delimited prefix
      // with a TRAILING `:` (e.g. `"dir:"`) when a sub-prefix is requested, or
      // empty/`null` for the whole mount. Strip the trailing colon, then map to
      // the container to start listing at.
      const prefix = relativePrefixKey(base_);
      const startContainer = prefix ? keyToContainerUrl(base, prefix) : base;
      const keys: string[] = [];
      const txHeaders = asTx(opts).headers;
      await collectKeys(
        startContainer,
        base,
        fetchImpl,
        txHeaders,
        options.headers,
        0,
        maxDepth,
        keys,
      );
      return keys;
    },

    async clear(base_, opts) {
      // Gather everything under the prefix, then delete resources before their
      // containers (depth-first leaves-first) so a container is empty when removed.
      // `base_` is unstorage's `relativeBase` (trailing-colon prefix or empty/null).
      const prefix = relativePrefixKey(base_);
      const startContainer = prefix ? keyToContainerUrl(base, prefix) : base;
      const txHeaders = asTx(opts).headers;
      const headers = buildHeaders(options.headers, txHeaders);
      // Only delete the prefix container itself when a prefix was given; never
      // delete the driver base container.
      await clearContainer(startContainer, base, fetchImpl, headers, prefix !== undefined);
    },

    async watch(callback: WatchCallback) {
      if (!watchEnabled) {
        options.onWatchDegrade?.("watch disabled (set `watch: true` in driver options)");
        return () => {};
      }
      // Apply the driver `headers` to the notification discovery/subscribe
      // requests too (the option is documented as merged into EVERY request).
      const watchFetch: typeof globalThis.fetch = (input, init) =>
        fetchImpl(input, {
          ...init,
          headers: { ...options.headers, ...(init?.headers as object) },
        });
      const startOpts = {
        base,
        fetch: watchFetch,
        callback,
        ...(options.wsFactory ? { wsFactory: options.wsFactory } : {}),
        ...(options.onWatchDegrade ? { onDegrade: options.onWatchDegrade } : {}),
      };
      const active = await startWatch(startOpts);
      activeWatches.add(active);
      return () => {
        active.unwatch();
        activeWatches.delete(active);
      };
    },

    dispose() {
      for (const active of activeWatches) {
        active.unwatch();
      }
      activeWatches.clear();
    },
  };

  return driver;
});

/**
 * Recursively collect resource keys under `containerUrl`. Sub-containers are
 * recursed into while `depth < maxDepth`. Only NON-container members become keys
 * (an unstorage key denotes a resource).
 */
async function collectKeys(
  containerUrl: string,
  base: string,
  fetchImpl: typeof globalThis.fetch,
  txHeaders: Record<string, string> | undefined,
  driverHeaders: Record<string, string> | undefined,
  depth: number,
  maxDepth: number,
  out: string[],
): Promise<void> {
  const headers = buildHeaders(driverHeaders, txHeaders);
  const members = await listContainerWithHeaders(containerUrl, base, fetchImpl, headers);
  if (members === null) {
    return;
  }
  for (const member of members) {
    if (member.container) {
      if (depth + 1 <= maxDepth) {
        await collectKeys(
          member.url,
          base,
          fetchImpl,
          txHeaders,
          driverHeaders,
          depth + 1,
          maxDepth,
          out,
        );
      }
    } else {
      const key = urlToKey(base, member.url);
      if (key) {
        out.push(key);
      }
    }
  }
}

/** Recursively delete everything under `containerUrl` (leaves before containers). */
async function clearContainer(
  containerUrl: string,
  base: string,
  fetchImpl: typeof globalThis.fetch,
  headers: Record<string, string>,
  deleteSelf: boolean,
): Promise<void> {
  const members = await listContainerWithHeaders(containerUrl, base, fetchImpl, headers);
  if (members !== null) {
    for (const member of members) {
      if (member.container) {
        await clearContainer(member.url, base, fetchImpl, headers, true);
      } else {
        assertWithinBase(base, member.url);
        const res = await fetchImpl(member.url, { method: "DELETE", headers });
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          throw new SolidHttpError("DELETE", member.url, res.status, res.statusText);
        }
      }
    }
  }
  if (deleteSelf) {
    assertWithinBase(base, containerUrl);
    const res = await fetchImpl(containerUrl, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new SolidHttpError("DELETE", containerUrl, res.status, res.statusText);
    }
  }
}

/** listContainer that also threads request headers (auth, etc.). */
async function listContainerWithHeaders(
  containerUrl: string,
  base: string,
  fetchImpl: typeof globalThis.fetch,
  headers: Record<string, string>,
) {
  const wrapped: typeof globalThis.fetch = (input, init) =>
    fetchImpl(input, { ...init, headers: { ...headers, ...(init?.headers as object) } });
  return listContainer(containerUrl, base, wrapped);
}

/**
 * Normalise setItemRaw's value into a BodyInit accepted by `fetch` in both Node
 * and the browser. Binary inputs are copied into a fresh `ArrayBuffer` (an
 * unambiguous `BodyInit` across lib targets); strings pass through; anything else
 * falls back to JSON (callers should prefer `setItem` for JSON).
 */
function toBodyInit(value: unknown): BodyInit {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    // Copy the exact view bytes into a standalone ArrayBuffer (avoids leaking a
    // larger backing buffer and sidesteps lib BodyInit/ArrayBufferView strictness).
    const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return view.slice().buffer;
  }
  if (typeof value === "string") {
    return value;
  }
  // Fall back to JSON for plain objects (callers should prefer setItem for JSON).
  return JSON.stringify(value);
}

/**
 * Internal testing seam types, re-exported so the `wsFactory` field on
 * {@link SolidDriverOptions} is resolvable in the public `.d.ts`. Not part of the
 * stable public contract.
 * @internal
 */
export type { WatchSocket, WatchSocketFactory } from "./watch.js";
export type { SolidDriverOptions as Options };
export default solidDriver;
