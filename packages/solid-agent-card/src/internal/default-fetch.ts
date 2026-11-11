// AUTHORED-BY Claude Opus 5.5
//
// The default SSRF boundary for every fetch this package issues when the caller injects
// none. Agent pointers and descriptor URLs come from possibly hostile profiles, so the
// default is a DNS-pinned guarded fetch: private, loopback and link-local targets are
// refused, every redirect hop is re-validated, and bodies and time are bounded.

import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

let shared: typeof globalThis.fetch | undefined;

/** The caller's fetch, or the package's shared guarded default. */
export function fetchOrGuarded(fetch?: typeof globalThis.fetch): typeof globalThis.fetch {
  if (fetch !== undefined) return fetch;
  shared ??= createNodeGuardedFetch({ maxBytes: 1024 * 1024, timeoutMs: 10_000 });
  return shared;
}
