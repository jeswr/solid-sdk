// AUTHORED-BY Claude Fable 5
//
// pristine — the ONE place this package captures / recovers the pristine native
// `fetch`, i.e. the credential-free transport every OIDC hop (discovery, client
// registration, the token grants) MUST ride.
//
// WHY THIS IS THE KEYSTONE (the login-stall bug class, bead suite-tracker-8575):
// suite apps patch `globalThis.fetch` with a proactive authed wrapper whose
// credential boundary deliberately includes the ISSUER's origin. If a token
// provider's own OIDC traffic defaults to the (patched) global, the provider's
// discovery request re-enters the patch → `provider.upgrade(discoveryRequest)` →
// which single-flights onto the very login promise that ISSUED the discovery
// request — a circular await that stalls interactive login forever. 21 hand-copied
// providers each independently missed or re-fixed this. This module makes the safe
// wiring structural:
//
//   1. The pristine fetch is snapshotted at MODULE LOAD (before this package could
//      have patched anything).
//   2. Every fetch wrapper THIS package installs is BRANDED (a `Symbol.for` marker
//      pointing at the pristine base it wraps). {@link resolvePristineFetch}
//      unwraps the brand chain — so even if this module is (re)loaded AFTER one of
//      our own wrappers patched the global (a second bundle copy, a late dynamic
//      import), the snapshot recovers the TRUE pristine fetch instead of
//      recapturing our own patch. That closes the "fallback chain recaptures a
//      patched global" residual the shared-logic review flagged.
//   3. There is NO configuration knob anywhere in this package that routes an OIDC
//      hop through a live read of `globalThis.fetch`.
//
// A FOREIGN patch installed before this module ever loads is indistinguishable
// from the native fetch (nothing can unwrap an unmarked closure) — but that
// foreign wrapper is not ours, so OUR provider can never re-enter OUR patch: the
// self-deadlock is unrepresentable. A consumer in that (exotic) situation can
// still inject a known-pristine fetch explicitly via the config seam.

/**
 * The GLOBAL-REGISTRY brand a solid-auth-core-installed fetch wrapper carries: a
 * non-enumerable own property whose value is the PRISTINE base fetch the wrapper
 * runs over. `Symbol.for` (not a local `Symbol()`) so two bundled copies of this
 * module unwrap each other's wrappers.
 */
export const PRISTINE_BASE: symbol = Symbol.for("@jeswr/solid-auth-core:pristine-base");

/** Upper bound on brand-chain unwrapping (defensive: a cycle can never spin). */
const MAX_UNWRAP = 32;

/**
 * Brand `wrapper` as a solid-auth-core fetch wrapper over `base`, so a later
 * {@link resolvePristineFetch} can recover `base` from it. Returns `wrapper`.
 * Best-effort: a frozen function simply stays unbranded (fail-safe — unwrapping
 * then stops at it, which is no worse than today's ecosystem-wide behaviour).
 */
export function brandFetchWrapper(wrapper: typeof fetch, base: typeof fetch): typeof fetch {
  try {
    Object.defineProperty(wrapper, PRISTINE_BASE, {
      value: base,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch {
    // non-extensible/frozen wrapper — leave unbranded (see doc above)
  }
  return wrapper;
}

/**
 * Recover the pristine base from a (possibly solid-auth-core-wrapped) fetch by
 * walking the {@link PRISTINE_BASE} brand chain. An unbranded function is
 * returned as-is. Bounded (no cycle can spin it).
 */
export function resolvePristineFetch(candidate: typeof fetch): typeof fetch {
  let current = candidate;
  for (let i = 0; i < MAX_UNWRAP; i++) {
    const base = (current as unknown as Record<symbol, unknown>)[PRISTINE_BASE];
    if (typeof base !== "function") return current;
    current = base as typeof fetch;
  }
  return current;
}

/**
 * The PRISTINE native fetch, snapshotted ONCE at MODULE LOAD — before any code
 * that imported this package could patch the global — and UNWRAPPED through the
 * brand chain in case one of our own wrappers (another bundle copy) already had.
 * This is the credential-leak boundary's anchor: the auth engine's `publicFetch`
 * defaults to THIS snapshot, NOT to a re-read of the (possibly already-patched)
 * `globalThis.fetch` at construction time.
 *
 * NOTE the unwrap must happen BEFORE `.bind()` (binding erases own properties),
 * and a recovered branded base is already call-safe (our wrappers close over a
 * bound base), so only the raw native function needs binding.
 */
export const MODULE_PRISTINE_FETCH: typeof fetch | undefined = (() => {
  if (typeof globalThis === "undefined" || typeof globalThis.fetch !== "function") {
    return undefined;
  }
  const raw = globalThis.fetch;
  const resolved = resolvePristineFetch(raw);
  // A recovered branded base was stored pre-bound; the raw native fetch needs
  // binding to globalThis (unbound native fetch throws "Illegal invocation").
  return resolved === raw ? raw.bind(globalThis) : resolved;
})();
