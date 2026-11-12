// AUTHORED-BY Codex GPT-6.1-Sol
import { createLocalJWKSet, type JSONWebKeySet } from "jose";
import * as oauth from "oauth4webapi";
import type { ResolveIssuer } from "./core.js";
import { createDiscoveryCache } from "./discovery-cache.js";
import { createRefreshCooldowns } from "./refresh-cooldowns.js";

/** Options for shared discovery and JWKS coordination. All durations use milliseconds. */
export interface IssuerKeyResolverOptions {
  /** Anonymous SSRF-guarded transport; it must enforce DNS, redirect and response size limits. */
  outboundFetch: typeof fetch;
  /** Millisecond clock. Default Date.now. */
  now?: () => number;
  /** Per-cache and per-in-flight-map capacity, also the maximum live refresh cooldowns. Default 1000. */
  maxEntries?: number;
  /** Deadline covering each load and its response body. Default 5000. */
  timeoutMs?: number;
  /** Test/development only: permit credential-free loopback HTTP URLs. */
  allowInsecureLoopback?: boolean;
}

/** Credential-free HTTPS identifier, with explicit loopback HTTP relaxation for fixtures. */
export function issuerUrl(value: unknown, allowLoopback = false): URL {
  if (
    typeof value !== "string" ||
    !/^https?:\/\//u.test(value) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject before URL normalization.
    /[\u0000-\u0020\\]/u.test(value) ||
    !URL.canParse(value)
  )
    throw new Error("Invalid URL");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(allowLoopback && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/u.test(url.hostname)))
  )
    throw new Error("Invalid URL");
  return url;
}

function missingKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ERR_JWKS_NO_MATCHING_KEY";
}

/**
 * Construct once and reuse. Discovery and JWKS have bounded ten-minute caches and per-URL
 * coalescing. Unknown keys retry the latest snapshot, then refresh at most once per minute.
 * Failed refreshes retain the original cache expiry and consume the cooldown. Capacity pressure
 * evicts expired then oldest cooldowns; a conservative shared deadline protects live evictions.
 * This resolves keys only: callers must enforce issuer trust, token claims and DPoP binding.
 */
export function createIssuerKeyResolver(options: IssuerKeyResolverOptions): ResolveIssuer {
  const now = options.now ?? Date.now;
  const metadata = createDiscoveryCache<string>(now, options);
  const jwks = createDiscoveryCache<{
    keys: ReturnType<typeof createLocalJWKSet>;
    fetchedAt: number;
  }>(now, options);
  const reserveRefresh = createRefreshCooldowns(now, options.maxEntries ?? 1000);
  const transport: typeof fetch = (input, init) =>
    options.outboundFetch(input, { ...init, credentials: "omit" });

  return async (issuer) => {
    const url = issuerUrl(issuer, options.allowInsecureLoopback);
    if (url.search || url.hash) throw new Error("Invalid issuer");
    const uri = await metadata(issuer, async (signal) => {
      const response = await oauth.discoveryRequest(url, {
        algorithm: "oidc",
        [oauth.customFetch]: transport,
        signal,
        ...(url.protocol === "http:" ? { [oauth.allowInsecureRequests]: true } : {}),
      });
      const document = await oauth.processDiscoveryResponse(url, response);
      // oauth validates normalized issuer URLs; preserve the exact issuer claim comparison too.
      if (document.issuer !== issuer) throw new Error("Issuer mismatch");
      const location = issuerUrl(document.jwks_uri, options.allowInsecureLoopback);
      if (location.hash) throw new Error("Invalid JWKS URL");
      return location.href;
    });
    const load = async (signal: AbortSignal) => {
      const response = await transport(uri, { signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Discovery unavailable");
      return {
        keys: createLocalJWKSet((await response.json()) as JSONWebKeySet),
        fetchedAt: now(),
      };
    };
    return {
      jwks: async (header, token) => {
        let cached = await jwks(uri, load);
        try {
          return await cached.keys(header, token);
        } catch (error) {
          if (!missingKey(error)) throw error;
          // A competing refresh may have settled while this missing-key rejection was queued.
          const latest = jwks.peek(uri);
          if (latest && latest !== cached) {
            cached = latest;
            try {
              return await cached.keys(header, token);
            } catch (retryError) {
              if (!missingKey(retryError)) throw retryError;
            }
          }
          if (!jwks.pending(uri)) {
            if (now() - cached.fetchedAt < 60_000 || !reserveRefresh(uri)) throw error;
          }
          cached = await jwks(uri, load, true);
          return cached.keys(header, token);
        }
      },
      allowInsecureRequests: url.protocol === "http:",
    };
  };
}
