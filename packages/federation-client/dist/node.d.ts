import { type NodePinningOptions } from "@jeswr/guarded-fetch/node";
import type { Agent } from "undici";
export { type ConnectLookup, createNodeGuardedFetch, createValidatingLookup, type NodePinningOptions, nodeGuardedFetch, type ResolveAll, } from "@jeswr/guarded-fetch/node";
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
 * `timeoutMs` is NOT supported by the bare dispatcher (it has no effect on the connect timeout —
 * see the module header). The option type is the full {@link NodePinningOptions} so any
 * timeout-free value is accepted, but passing a `timeoutMs` THROWS at runtime (it is never
 * silently ignored). Use {@link createNodeGuardedFetch} for a timeout-bounded fetch.
 */
export declare function createPinningDispatcher(options?: NodePinningOptions): Agent;
//# sourceMappingURL=node.d.ts.map