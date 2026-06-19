import { type NodePinningOptions } from "@jeswr/guarded-fetch/node";
import type { Agent } from "undici";
export { type ConnectLookup, createNodeGuardedFetch, createValidatingLookup, type NodePinningOptions, nodeGuardedFetch, type ResolveAll, } from "@jeswr/guarded-fetch/node";
/**
 * Options for {@link createPinningDispatcher}. Identical to guarded-fetch's
 * {@link NodePinningOptions} EXCEPT `timeoutMs` is forbidden: the bare dispatcher does not apply a
 * connect timeout (see the module header) — passing one would be silently ignored, so it is a
 * type error here. Use {@link createNodeGuardedFetch} for a timeout-bounded fetch.
 *
 * The `timeoutMs?: never` intersection (NOT a bare `Omit`) makes the ban NEGATIVE: a plain
 * `Omit<NodePinningOptions, "timeoutMs">` only rejects a fresh object LITERAL carrying `timeoutMs`
 * (excess-property check) — a variable already typed as `NodePinningOptions` (with a real
 * `timeoutMs?: number`) would still be structurally assignable to the omit and slip through
 * silently. `timeoutMs?: never` rejects ANY value whose `timeoutMs` is not `undefined`/absent,
 * including such a pre-typed variable (roborev Medium).
 */
export type PinningDispatcherOptions = Omit<NodePinningOptions, "timeoutMs"> & {
    readonly timeoutMs?: never;
};
/**
 * Build an `undici.Agent` that PINS each connection to a freshly-resolved, validated IP — the
 * rebinding-closing dispatcher, delegated verbatim to the consolidated, audited
 * `@jeswr/guarded-fetch/node` implementation (protocol-aware: `http:` refused unless
 * allowLoopback; loopback-only validating lookup for a permitted `http:` hop; public-address
 * lookup for `https:`; direct per-scheme classification of IP-LITERAL targets the lookup is
 * skipped for). Prefer {@link createNodeGuardedFetch}, which wires this together with the full
 * SSRF guard (scheme/userinfo/literal checks, redirect re-validation, body + time caps); use
 * this directly only when composing your own request pipeline and already applying those checks.
 *
 * NOTE: unlike this package's pre-consolidation dispatcher, `timeoutMs` is NOT accepted (it would
 * have no effect on the connect timeout) — see {@link PinningDispatcherOptions}.
 */
export declare function createPinningDispatcher(options?: PinningDispatcherOptions): Agent;
//# sourceMappingURL=node.d.ts.map