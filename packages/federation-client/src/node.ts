// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// `@jeswr/federation-client/node` — the SSRF-safe NODE fetch path that fully closes the
// DNS-rebinding (TOCTOU) hole on the server side. This module is now a THIN RE-EXPORT of
// `@jeswr/guarded-fetch/node` — the consolidated suite implementation of the exact same
// resolve-once → validate-all → PIN-the-IP undici dispatcher that previously lived inline
// here. Consolidating onto ONE audited guard is the goal; the behaviour (and its security
// posture) is unchanged.
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
// `dist/index.js` (both resolve to the inlined guarded-fetch root), so an error thrown by
// `@jeswr/federation-client/node` still satisfies `instanceof SsrfError` imported from
// `@jeswr/federation-client`.
//
// SsrfError IDENTITY. `SsrfError` is re-exported from THIS package's root (`./index.ts`),
// not separately from `@jeswr/guarded-fetch/node`, so the class a consumer catches from the
// `.` entry and the `./node` entry is one and the same (the inlined guarded-fetch root is
// shared between dist/index.js and dist/node.js by the build keeping `./index.js` external
// in the node bundle).

export {
  type ConnectLookup,
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  type NodePinningOptions,
  nodeGuardedFetch,
  type ResolveAll,
} from "@jeswr/guarded-fetch/node";
