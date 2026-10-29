// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  createGuardedFetch,
  type GuardOptions,
  type guardedFetch,
  refuseRedirects,
} from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

/** Trusted injection is for tests or an already DNS-pinning transport. */
export interface OriginFetchOptions {
  readonly transport?: typeof guardedFetch;
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
  const transport =
    options.transport ??
    createNodeGuardedFetch({ allowLoopback: options.allowLoopback, maxRedirects: 0 });
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
