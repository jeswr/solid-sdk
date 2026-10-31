// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/unstorage-solid` — an {@link https://unstorage.unjs.io | unstorage}
 * `defineDriver()` driver that backs unstorage's KV API with a
 * {@link https://solidproject.org | Solid} pod over LDP.
 *
 * unstorage keys keep their existing paths. Values are opaque KV blobs;
 * StorageClient owns protocol-specific reads, writes and container listings.
 *
 * Authentication is injected: pass a (DPoP-bound) authenticated `fetch` — e.g. a
 * browser Solid session's `fetch`, or a Node client-credentials fetch from
 * `@jeswr/solid-dpop`. With no `fetch` the global `fetch` is used (only public
 * resources will work).
 *
 * @packageDocumentation
 */

import { createNotifications, type NotificationsClient } from "@jeswr/pod-notifications";
import {
  type Body,
  type ReadResult,
  type StorageClient,
  StorageError,
} from "@jeswr/storage-client";
import type { Driver, StorageMeta, StorageValue, WatchCallback } from "unstorage";
import { defineDriver } from "unstorage";
import { listContainer } from "./container.js";
import { assertWithinBase, keyToContainerUrl, keyToUrl, normalizeBase, urlToKey } from "./keys.js";
import { createSameOriginRedirectRefusingFetch } from "./scope.js";
import { isMissing, storageFromFetch, transportCause } from "./storage.js";
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
  /** Existing storage client. Its transport owns authentication and headers. */
  storage?: StorageClient;
  /** Existing notification client; otherwise built from storage and fetch. */
  notifications?: NotificationsClient;
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
   * Enable `watch()` through pod-notifications (currently polling). When
   * `false` (default), `watch()` is a graceful no-op. Watch always degrades
   * to the SDK polling fallback when no push transport is available.
   */
  watch?: boolean;
  /**
   * Legacy internal seam retained for compatibility. Transport selection now belongs
   * to pod-notifications; this option is unused by the current polling client.
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

/** Back unstorage keys with the public storage SDK and optional change subscriptions. */
const solidDriver = defineDriver<SolidDriverOptions, undefined>((options) => {
  if (!options || typeof options.base !== "string" || options.base.length === 0) {
    throw new Error("[unstorage-solid] `base` option is required");
  }
  const base = normalizeBase(options.base);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!options.storage && typeof fetchImpl !== "function") {
    throw new Error("[unstorage-solid] no `fetch` available (pass `fetch` in options)");
  }
  const activeWatches = new Set<ActiveWatch>();
  let disposed = false;
  const client = (
    tx: SolidTransactionOptions = {},
    observe?: (url: string, headers: Headers) => void,
  ) =>
    options.storage
      ? Promise.resolve(options.storage)
      : storageFromFetch(base, fetchImpl, options.headers, tx.headers, observe);

  const run = async <T>(method: string, url: string, operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StorageError && error.status !== null) {
        throw new SolidHttpError(method, url, error.status, error.message);
      }
      throw transportCause(error);
    }
  };

  const observeResource = async (storage: StorageClient, url: string): Promise<ReadResult> => {
    try {
      return await storage.head(url);
    } catch (error) {
      if (error instanceof StorageError && error.status === 405) return storage.read(url);
      throw error;
    }
  };

  const remove = async (storage: StorageClient, url: string): Promise<void> => {
    assertWithinBase(base, url);
    try {
      const current = await observeResource(storage, url);
      await current.body?.cancel();
      if (!current.etag)
        throw new Error("[unstorage-solid] cannot delete a resource without an ETag");
      await storage.delete(url, { ifMatch: current.etag });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  };

  const ensureParents = async (storage: StorageClient, url: string): Promise<void> => {
    const parts = new URL(url).pathname.slice(new URL(base).pathname.length).split("/");
    parts.pop();
    let parent = base;
    for (const part of parts) {
      const expected = `${parent}${part}/`;
      try {
        const current = await observeResource(storage, expected);
        await current.body?.cancel();
        if (current.kind !== "container")
          throw new Error("[unstorage-solid] parent is not a container");
        parent = expected;
        continue;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      try {
        const created = await storage.create(parent, null, {
          name: decodeURIComponent(part),
          kind: "container",
        });
        if (created.url !== expected)
          throw new Error("[unstorage-solid] storage did not preserve the container name");
      } catch (error) {
        if (!(error instanceof StorageError) || ![405, 409, 412].includes(error.status ?? 0))
          throw error;
      }
      parent = expected;
    }
  };

  const put = async (
    key: string,
    body: Body,
    contentType: string,
    tx: SolidTransactionOptions,
  ): Promise<void> => {
    const url = keyToUrl(base, key);
    await run("PUT", url, async () => {
      const storage = await client(tx);
      const write = async () => {
        if (storage.protocol !== "lws" || tx.etag) {
          return storage.write(url, body, { contentType, ifMatch: tx.etag || "*" });
        }
        try {
          await storage.head(url);
        } catch (error) {
          if (!isMissing(error)) throw error;
          const parent = new URL("./", url).href;
          const result = await storage.create(parent, body, {
            name: decodeURIComponent(new URL(url).pathname.split("/").pop() as string),
            contentType,
          });
          if (result.url !== url)
            throw new Error("[unstorage-solid] storage did not preserve the key name");
          return result;
        }
        return storage.write(url, body, { contentType, ifMatch: "*" });
      };
      try {
        await write();
      } catch (error) {
        if (error instanceof StorageError && (error.status === 412 || error.status === 428)) {
          throw new SolidPreconditionFailedError(url, error.status);
        }
        if (
          !tx.etag &&
          error instanceof StorageError &&
          (error.status === 404 || error.status === 409)
        ) {
          await ensureParents(storage, url);
          try {
            await write();
          } catch (retryError) {
            if (
              retryError instanceof StorageError &&
              (retryError.status === 412 || retryError.status === 428)
            ) {
              throw new SolidPreconditionFailedError(url, retryError.status);
            }
            throw retryError;
          }
        } else throw error;
      }
    });
  };

  const members = (storage: StorageClient, url: string) => listContainer(url, base, storage);
  const collect = async (
    storage: StorageClient,
    url: string,
    depth: number,
    maxDepth: number,
    out: string[],
  ) => {
    for (const member of (await members(storage, url)) ?? []) {
      if (member.container) {
        if (depth < maxDepth) await collect(storage, member.url, depth + 1, maxDepth, out);
      } else {
        const key = urlToKey(base, member.url);
        if (key) out.push(key);
      }
    }
  };
  const clear = async (storage: StorageClient, url: string, deleteSelf: boolean) => {
    for (const member of (await members(storage, url)) ?? []) {
      if (member.container) await clear(storage, member.url, true);
      else await remove(storage, member.url);
    }
    if (deleteSelf) await remove(storage, url);
  };

  const driver: Driver<SolidDriverOptions, undefined> = {
    name: DRIVER_NAME,
    options,
    flags: { maxDepth: true },
    async hasItem(key, opts) {
      const url = keyToUrl(base, key);
      return run("HEAD", url, async () => {
        try {
          const result = await observeResource(await client(asTx(opts)), url);
          await result.body?.cancel();
          return true;
        } catch (error) {
          if (isMissing(error)) return false;
          throw error;
        }
      });
    },
    async getItem(key, opts) {
      const url = keyToUrl(base, key);
      return run("GET", url, async () => {
        try {
          return (await (await (await client(asTx(opts))).read(url)).text()) as StorageValue;
        } catch (error) {
          if (isMissing(error)) return null;
          throw error;
        }
      });
    },
    async getItemRaw(key, opts) {
      const url = keyToUrl(base, key);
      return run("GET", url, async () => {
        try {
          return await (
            await (await client(asTx(opts))).read(url, { accept: "application/octet-stream" })
          ).bytes();
        } catch (error) {
          if (isMissing(error)) return null;
          throw error;
        }
      });
    },
    async setItem(key, value, opts) {
      const tx = asTx(opts);
      await put(
        key,
        value,
        tx.contentType ?? options.defaultContentType ?? "text/plain; charset=utf-8",
        tx,
      );
    },
    async setItemRaw(key, value, opts) {
      const tx = asTx(opts);
      await put(key, toBody(value), tx.contentType ?? "application/octet-stream", tx);
    },
    async removeItem(key, opts) {
      const url = keyToUrl(base, key);
      await run("DELETE", url, async () => remove(await client(asTx(opts)), url));
    },
    async getMeta(key, opts) {
      const url = keyToUrl(base, key);
      return run("HEAD", url, async () => {
        try {
          let length: string | null = null;
          const storage = await client(asTx(opts), (target, headers) => {
            if (target === url) length = headers.get("content-length");
          });
          const result = await observeResource(storage, url);
          await result.body?.cancel();
          const meta: StorageMeta = { status: result.status };
          if (result.lastModified) meta.mtime = result.lastModified;
          if (result.etag) meta.etag = result.etag;
          if (result.contentType) meta.mimeType = result.contentType;
          if (length !== null && length !== "" && Number.isFinite(Number(length)))
            meta.size = Number(length);
          // Injected clients expose size in entries, rather than raw HTTP headers.
          if (options.storage) {
            try {
              const parent = await storage.parentOf(url);
              if (parent) {
                assertWithinBase(base, parent);
                for await (const entry of storage.listAll(parent)) {
                  if (entry.url === url) {
                    if (entry.size !== null) meta.size = entry.size;
                    break;
                  }
                }
              }
            } catch {
              /* Size is optional when listing permission is unavailable. */
            }
          }
          return meta;
        } catch (error) {
          if (isMissing(error)) return null;
          throw error;
        }
      });
    },
    async getKeys(base_, opts) {
      const prefix = relativePrefixKey(base_);
      const url = prefix ? keyToContainerUrl(base, prefix) : base;
      return run("GET", url, async () => {
        const out: string[] = [];
        await collect(
          await client(asTx(opts)),
          url,
          0,
          typeof opts?.maxDepth === "number" ? opts.maxDepth : Infinity,
          out,
        );
        return out;
      });
    },
    async clear(base_, opts) {
      const prefix = relativePrefixKey(base_);
      const url = prefix ? keyToContainerUrl(base, prefix) : base;
      await run("DELETE", url, async () =>
        clear(await client(asTx(opts)), url, prefix !== undefined),
      );
    },
    async watch(callback: WatchCallback) {
      if (disposed) return () => {};
      if (options.watch !== true) {
        options.onWatchDegrade?.("watch disabled (set `watch: true` in driver options)");
        return () => {};
      }
      let active: ActiveWatch;
      try {
        const notifications =
          options.notifications ??
          createNotifications({
            storage: await client(),
            fetch: (input, init) => {
              const guarded = createSameOriginRedirectRefusingFetch(
                new URL(base).origin,
                fetchImpl,
              );
              const headers = new Headers(options.headers);
              new Headers(init?.headers).forEach((value, key) => {
                headers.set(key, value);
              });
              return guarded(input, { ...init, headers });
            },
          });
        active = await startWatch({
          base,
          notifications,
          callback,
          onDegrade: options.onWatchDegrade,
        });
      } catch {
        options.onWatchDegrade?.("notification setup failed");
        return () => {};
      }
      if (disposed) {
        active.unwatch();
        return () => {};
      }
      activeWatches.add(active);
      return () => {
        active.unwatch();
        activeWatches.delete(active);
      };
    },
    dispose() {
      disposed = true;
      for (const active of activeWatches) active.unwatch();
      activeWatches.clear();
    },
  };
  return driver;
});

function toBody(value: unknown): Body {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  return typeof value === "string" ? value : JSON.stringify(value);
}

export { SolidRedirectError } from "./scope.js";
export type { WatchSocket, WatchSocketFactory } from "./watch.js";
export type { SolidDriverOptions as Options };
export default solidDriver;
