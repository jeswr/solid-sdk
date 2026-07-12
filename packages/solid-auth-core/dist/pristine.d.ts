/**
 * The GLOBAL-REGISTRY brand a solid-auth-core-installed fetch wrapper carries: a
 * non-enumerable own property whose value is the PRISTINE base fetch the wrapper
 * runs over. `Symbol.for` (not a local `Symbol()`) so two bundled copies of this
 * module unwrap each other's wrappers.
 */
export declare const PRISTINE_BASE: symbol;
/**
 * Brand `wrapper` as a solid-auth-core fetch wrapper over `base`, so a later
 * {@link resolvePristineFetch} can recover `base` from it. Returns `wrapper`.
 * Best-effort: a frozen function simply stays unbranded (fail-safe — unwrapping
 * then stops at it, which is no worse than today's ecosystem-wide behaviour).
 */
export declare function brandFetchWrapper(wrapper: typeof fetch, base: typeof fetch): typeof fetch;
/**
 * Recover the pristine base from a (possibly solid-auth-core-wrapped) fetch by
 * walking the {@link PRISTINE_BASE} brand chain. An unbranded function is
 * returned as-is. Bounded (no cycle can spin it).
 */
export declare function resolvePristineFetch(candidate: typeof fetch): typeof fetch;
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
export declare const MODULE_PRISTINE_FETCH: typeof fetch | undefined;
//# sourceMappingURL=pristine.d.ts.map