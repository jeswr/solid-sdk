import type { ClearableStore, ExpiringValue } from "@key-value-kit/core";
import { withExpiry } from "@key-value-kit/core";
import { createIndexedDbStore } from "@key-value-kit/storage/indexeddb";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import type * as oauth from "oauth4webapi";
import type { DPoPTokenCacheEntry, RefreshSessionRecord } from "./OidcSession.js";
import { SessionFence } from "./SessionFence.js";
import type { StorageContext } from "./StorageContext.js";

export interface ProviderCaches {
  issuer: ClearableStore<string>;
  authorizationServer: ClearableStore<oauth.AuthorizationServer>;
  storageContext: ClearableStore<StorageContext>;
  client: ClearableStore<oauth.Client>;
  token: ClearableStore<DPoPTokenCacheEntry>;
  /** Refresh-only session records; present only with `persistSessions`. */
  sessions?: ClearableStore<RefreshSessionRecord>;
  /** Fence whose generation lives in IndexedDB, shared by every tab using the namespace. */
  fence: SessionFence;
}

export interface BrowserCacheOptions {
  /** Lifetime of issuer choices, discovery metadata and storage mappings. @defaultValue 1 hour */
  readonly metadataMaxAgeMs?: number;

  /**
   * Persist refresh tokens (with their non-extractable DPoP keys) in IndexedDB so reloads restore the session
   * with a refresh grant. Access and ID tokens stay in memory. @defaultValue false
   */
  readonly persistSessions?: boolean;
}

/**
 * Explicit browser policy: public metadata in IndexedDB with a TTL; client registrations and credentials in
 * memory; optional refresh-only session persistence; a cross-tab fence in IndexedDB. The namespace must
 * isolate application, client configuration and account. Storage failures reject without silently switching
 * backends.
 */
export function createBrowserCaches(
  namespace: string,
  options: BrowserCacheOptions | number = {},
): ProviderCaches {
  if (namespace.length === 0) throw new TypeError("A cache namespace is required");
  const { metadataMaxAgeMs = 60 * 60 * 1000, persistSessions = false } =
    typeof options === "number" ? { metadataMaxAgeMs: options } : options;
  const expiring = <T extends {}>(name: string): ClearableStore<T> =>
    withExpiry(createIndexedDbStore<ExpiringValue<T>>({ namespace: `${namespace}:v2:${name}` }), {
      ttlMs: metadataMaxAgeMs,
    });

  return {
    issuer: expiring<string>("issuer"),
    authorizationServer: expiring<oauth.AuthorizationServer>("authorization-server"),
    storageContext: expiring<StorageContext>("storage-context"),
    client: createMemoryStore(),
    token: createMemoryStore(),
    ...(persistSessions
      ? {
          sessions: createIndexedDbStore<RefreshSessionRecord>({
            namespace: `${namespace}:v2:sessions`,
          }),
        }
      : {}),
    fence: new SessionFence(namespace, {
      store: createIndexedDbStore<number>({ namespace: `${namespace}:v2:fence` }),
    }),
  };
}
