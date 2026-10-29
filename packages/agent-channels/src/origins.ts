// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  createGuardedFetch,
  type GuardOptions,
  type guardedFetch,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

/** Trusted injection constructs a single-hop DNS-pinning transport (or a test fake). */
export interface OriginFetchOptions {
  /** Apply maxRedirects at construction; do not wrap an already-following transport. */
  readonly createTransport?: (options: {
    readonly maxRedirects: 0;
    readonly allowLoopback: boolean;
  }) => typeof guardedFetch;
  readonly allowLoopback?: boolean;
  readonly dnsLookup?: GuardOptions["dnsLookup"];
}
/** Snapshot ORIGINS; reject before DNS or connection and refuse every redirect. */
export function createOriginScopedFetch(
  origins: ReadonlySet<string>,
  options: OriginFetchOptions = {},
): typeof guardedFetch {
  const allowed = new Set(origins);
  for (const origin of allowed) {
    const url = new URL(origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !["https:", "http:"].includes(url.protocol)
    )
      throw new TypeError("invalid binding origin");
  }
  const transport = (options.createTransport ?? createNodeGuardedFetch)(
    Object.freeze({ allowLoopback: options.allowLoopback ?? false, maxRedirects: 0 }),
  );
  const guarded = createGuardedFetch({
    pinningFetch: refuseRedirects(transport),
    allowLoopback: options.allowLoopback,
    dnsLookup: options.dnsLookup,
    requireDnsPinning: true,
    maxRedirects: 0,
  });
  return async (input, init) => {
    // Snapshot mutable URL/Request inputs before any asynchronous work.
    // Request construction resets inherited referrer settings unless supplied explicitly.
    const inherited = input instanceof Request ? input : undefined;
    const request = new Request(input, {
      ...init,
      referrer: init?.referrer ?? inherited?.referrer,
      referrerPolicy: init?.referrerPolicy ?? inherited?.referrerPolicy,
    });
    const url = new URL(request.url);
    if (!allowed.has(url.origin)) throw new TypeError("request origin is outside binding ORIGINS");
    // guarded-fetch normalizes only part of Request; retain the effective policies explicitly.
    return guarded(request, {
      // Explicit streams are incompatible with keepalive and no-cors; retain the body as bytes.
      body:
        (request.keepalive || request.mode === "no-cors") && request.body !== null
          ? await request.arrayBuffer()
          : request.body,
      redirect: "manual",
      integrity: request.integrity,
      cache: request.cache,
      mode: request.mode,
      keepalive: request.keepalive,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
    });
  };
}
