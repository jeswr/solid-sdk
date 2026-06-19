// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// `@jeswr/federation-client/node` — the SSRF-safe NODE fetch path that fully closes the
// DNS-rebinding (TOCTOU) hole on the server side. The undici DNS-pinning machinery is the
// consolidated suite implementation `@jeswr/guarded-fetch/node`: this module is now a THIN
// RE-EXPORT of it — the recommended fetches (`createNodeGuardedFetch` / `nodeGuardedFetch`),
// the low-level `createPinningDispatcher` escape hatch (delegated verbatim — see the
// timeoutMs note for the ONLY wrapper detail), the `createValidatingLookup` building block, and
// the `ConnectLookup` / `NodePinningOptions` / `ResolveAll` types. (Previously this package kept
// its OWN protocol-aware `createPinningDispatcher` to preserve a stricter http-loopback-only
// posture on that escape hatch; guarded-fetch's `createPinningDispatcher` is now itself
// protocol-aware — refuse `http:` unless allowLoopback, loopback-only lookup for a permitted
// `http:` hop, public-address lookup for `https:`, AND a direct per-scheme classification of
// IP-LITERAL targets the lookup never sees — so the SSRF-posture override became redundant and
// the connect logic is delegated to guarded-fetch at sha 92f75f7. See the parity note below.)
//
// WHAT it gives a Node consumer: `createNodeGuardedFetch` / `nodeGuardedFetch` — a
// `fetch`-shaped function that resolves a hostname ONCE, validates EVERY A/AAAA record
// against the suite block-list, and PINS the validated IP onto the connecting socket
// (undici's `Agent({ connect: { lookup } })` seam), so a hostile DNS server cannot flip a
// public answer at validation time to a private one at connect time. TLS SNI + cert
// validation stay against the ORIGINAL hostname (the connector's `servername`), so pinning
// to an IP never weakens cert checking, and `rejectUnauthorized` is never disabled.
// `requireDnsPinning` is forced ON, so a hostname rides the pinned socket or is refused.
//
// BROWSER ISOLATION (#92) PRESERVED. `@jeswr/guarded-fetch/node` is the ONLY artifact that
// imports `undici` / `node:*` builtins; the package's default `.` entry (`./index.ts` →
// `./ssrf.ts` → `@jeswr/guarded-fetch`) imports the browser-safe ROOT entry only, so the
// browser bundle never sees `undici`. The committed `dist/node.js` keeps `undici` external
// (a consumer-resolved npm dep) and references the SAME runtime `SsrfError` class as
// `dist/index.js` (both resolve to the inlined guarded-fetch root via the build's
// share-guarded-fetch-root plugin), so an error thrown by `@jeswr/federation-client/node`
// still satisfies `instanceof SsrfError` imported from `@jeswr/federation-client`.
//
// SsrfError IDENTITY. `SsrfError` is re-exported from THIS package's root (`./index.ts`),
// not separately from `@jeswr/guarded-fetch/node`, so the class a consumer catches from the
// `.` entry and the `./node` entry is one and the same (the inlined guarded-fetch root is
// shared between dist/index.js and dist/node.js by the build keeping `./index.js` external
// in the node bundle).
//
// PARITY of the bare `createPinningDispatcher` (the reason the override could be dropped).
// guarded-fetch's `createPinningDispatcher` is now at least as strict as this package's prior
// fed-client-owned override on every axis that override guarded:
//   - `http:` + `allowLoopback === false` → REFUSED outright in `connect()`, before any socket
//     (so the bare dispatcher can never reach `http://localhost` / `http://127.0.0.1` /
//     `http://10.0.0.5` with the default/production options);
//   - a permitted `http:` hop (allowLoopback) uses a LOOPBACK-ONLY validating lookup, so a flip
//     to a public address at connect time is refused — a plaintext request can never leak to a
//     public host;
//   - `https:` uses the standard `isPublicAddress`-based validating lookup, refusing a
//     private / metadata resolution (DNS-pinning / TOCTOU preserved);
//   - AND, STRICTER than the old override, it classifies an IP-LITERAL `opts.hostname` directly
//     in `connect()` (the validating lookup is skipped for a literal target), refusing a
//     private / loopback / link-local / metadata IP-literal the old override never validated.
// So re-exporting it does NOT weaken fed-client's posture; it strengthens the IP-literal case.
//
// `timeoutMs` IS NOT SILENTLY DROPPED (roborev Medium). This package's PRIOR bare dispatcher
// applied `options.timeoutMs ?? 10_000` as the undici CONNECT timeout. guarded-fetch's
// `createPinningDispatcher` does NOT wire a connect timeout (its `timeoutMs` is a guard
// whole-operation deadline, applied only by `createNodeGuardedFetch`'s fetch, not by the bare
// dispatcher's Agent). If we re-exported it raw, a caller doing
// `createPinningDispatcher({ timeoutMs })` would COMPILE (the option is inherited from the shared
// `NodePinningOptions`) but its connect timeout would be SILENTLY IGNORED — a hidden behaviour
// regression. We avoid the silent ignore WITHOUT over-narrowing the type: the parameter keeps the
// FULL `NodePinningOptions` shape (so a caller can pass a valid, timeout-FREE `NodePinningOptions`
// value — e.g. one shared with `createNodeGuardedFetch` — unchanged), and a RUNTIME guard THROWS
// loudly if `timeoutMs` is actually present. So an unsupported timeout fails FAST and visibly
// (never silently dropped), while every supported option shape stays assignable. (A type-level
// `Omit<…, "timeoutMs"> & { timeoutMs?: never }` was tried but rejected ANY value statically typed
// as `NodePinningOptions` even when it carried no timeout — too broad, roborev Medium.) Callers
// needing a timeout should use {@link createNodeGuardedFetch} (it honours `timeoutMs` as the
// whole-fetch deadline) — the recommended path anyway, since the bare dispatcher bypasses the
// shared guard. (Connect-timeout support belongs upstream in guarded-fetch's bare dispatcher —
// filed as a follow-up; once it lands, drop the runtime guard and forward `timeoutMs`.)

import {
  createPinningDispatcher as guardedCreatePinningDispatcher,
  type NodePinningOptions,
} from "@jeswr/guarded-fetch/node";
import type { Agent } from "undici";

// SsrfError is NOT used for the timeoutMs misconfiguration throw — a bad option is a programmer
// error, not an SSRF condition — so it stays a plain Error; importing SsrfError here would also
// pull the root bundle in needlessly.

export {
  type ConnectLookup,
  createNodeGuardedFetch,
  createValidatingLookup,
  type NodePinningOptions,
  nodeGuardedFetch,
  type ResolveAll,
} from "@jeswr/guarded-fetch/node";

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
export function createPinningDispatcher(options: NodePinningOptions = {}): Agent {
  // Fail LOUD, not silent: the bare dispatcher applies no connect timeout, so an explicit
  // timeoutMs would be silently dropped. Throw a clear programmer-error instead.
  if (options.timeoutMs !== undefined) {
    throw new Error(
      "createPinningDispatcher does not support `timeoutMs` (the bare dispatcher applies no " +
        "connect timeout). Use createNodeGuardedFetch({ timeoutMs }) for a timeout-bounded fetch.",
    );
  }
  // Delegate the entire SSRF connect posture to guarded-fetch's audited dispatcher (the spread
  // carries only the supported fields: `allowLoopback`, `resolveAll`, `ca`; `timeoutMs` is absent).
  return guardedCreatePinningDispatcher(options);
}
