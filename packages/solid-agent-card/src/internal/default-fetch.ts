// AUTHORED-BY Claude Opus 5.5
//
// The default SSRF boundary for every fetch this package issues when the caller injects
// none. Agent pointers and descriptor URLs come from possibly hostile profiles, so under
// Node the default is a DNS-pinned guarded fetch: private, loopback and link-local targets
// are refused, every redirect hop is re-validated, and bodies and time are bounded.
//
// The Node guard (undici, node:dns) is loaded lazily, only under Node, so importing this
// package never pulls it in. Browsers keep globalThis.fetch: CORS limits which responses a
// page can read, not which requests it can issue, so browser discovery of untrusted WebIDs
// is only partially guarded.

let shared: Promise<typeof globalThis.fetch> | undefined;

const isNode = () => typeof process !== "undefined" && typeof process.versions?.node === "string";

/** The caller's fetch, else the shared Node guard, else (in a browser) `globalThis.fetch`. */
export async function fetchOrGuarded(
  fetch?: typeof globalThis.fetch,
): Promise<typeof globalThis.fetch> {
  if (fetch !== undefined) return fetch;
  if (!isNode()) return globalThis.fetch;
  shared ??= import("@jeswr/guarded-fetch/node").then(({ createNodeGuardedFetch }) =>
    createNodeGuardedFetch({ maxBytes: 1024 * 1024, timeoutMs: 10_000 }),
  );
  return shared;
}
