// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// `@jeswr/federation-client/node` — the SSRF-safe NODE fetch path that fully closes the
// DNS-rebinding (TOCTOU) hole on the server side. The undici DNS-pinning machinery is the
// consolidated suite implementation `@jeswr/guarded-fetch/node`: this module is now a THIN
// RE-EXPORT of it — the recommended fetches (`createNodeGuardedFetch` / `nodeGuardedFetch`),
// the low-level `createPinningDispatcher` escape hatch, the `createValidatingLookup` building
// block, and the `ConnectLookup` / `NodePinningOptions` / `ResolveAll` types — with NO
// fed-client-owned wrapper. (Previously this package kept its OWN `createPinningDispatcher` to
// preserve a stricter http-loopback-only posture on that escape hatch; guarded-fetch's
// `createPinningDispatcher` is now itself protocol-aware — refuse `http:` unless allowLoopback,
// loopback-only lookup for a permitted `http:` hop, public-address lookup for `https:`, AND a
// direct per-scheme classification of IP-LITERAL targets the lookup never sees — so the override
// became redundant and was removed at guarded-fetch sha 92f75f7. See the parity note below.)
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
// So re-exporting it verbatim does NOT weaken fed-client's posture; it strengthens the
// IP-literal case. The dispatcher's prior `timeoutMs` → undici-connect-timeout wiring is gone,
// but that was a resource/DoS knob, never an SSRF gate (and undici applies its own default
// connect timeout), so the SSRF posture is unchanged.

export {
  type ConnectLookup,
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  type NodePinningOptions,
  nodeGuardedFetch,
  type ResolveAll,
} from "@jeswr/guarded-fetch/node";
