// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// SSRF-guarding fetch for consuming a registry / storage / verify URL (a user/config-
// supplied remote origin). This module is now a THIN RE-EXPORT of the consolidated,
// exhaustively-tested suite guard `@jeswr/guarded-fetch` — there is ONE audited SSRF guard
// for the whole suite, not a per-package copy. The previous inline classifier + guard
// (`./ip.ts` + a hand-rolled `SsrfGuard`) are removed; their behaviour is preserved (and
// strictly superseded) by `@jeswr/guarded-fetch`, proven by a differential oracle over an
// adversarial address corpus (no address the old guard blocked is now allowed) before this
// rewire.
//
// BROWSER-SAFE `.` ENTRY PRESERVED. We re-export ONLY guarded-fetch's DEFAULT (`.`) entry
// here, which is browser-safe by design: it has NO top-level `node:` import (its IP-literal
// classifier is pure-JS `classifyIpLiteral`, and the only `node:dns/promises` use is a lazy
// runtime `await import(...)` reached only on the Node branch). So this module — and the
// package's default `.` entry (`./index.ts`) that re-exports it — stays free of any static
// `node:net` / `node:dns` import, exactly as before, keeping the browser bundle (#92)
// shim-free. The undici DNS-pinning fetch lives in the SEPARATE `./node` entry (`./node.ts`
// → `@jeswr/guarded-fetch/node`), the ONLY artifact that imports `undici` / `node:*`.
//
// PUBLIC API STABILITY. We re-export exactly the surface this package published before
// (`createGuardedFetch`, `guardedFetch`, `SsrfError`, `isPublicAddress`,
// `isLoopbackAddress`, `classifyIpLiteral`, and the `DnsLookup` / `GuardOptions` /
// `ResolvedAddress` types) so `./index.ts` and `./registry.ts` are unchanged and a
// consumer's imports keep resolving. `@jeswr/guarded-fetch`'s `GuardOptions` is a strict
// SUPERSET of the old one (it adds an optional cloud-internal `hostnameDenylist`, a
// production `enforcePortGate`, an `allowedContentTypes` allowlist, and a `GuardError` for
// the non-SSRF policy refusals) — every old field is present with identical semantics, so a
// caller passing the old options is unaffected.

// The redirect-refusal primitive (`refuseRedirects` + `RedirectRefusedError`) is also
// re-exported: the consolidated `@jeswr/guarded-fetch/node` re-exports both FROM the
// guarded-fetch ROOT, and this package's build inlines that root ONCE into `dist/index.js`
// while keeping it EXTERNAL to `dist/node.js` (the share-root plugin — ONE shared SsrfError /
// RedirectRefusedError class). For `dist/node.js`'s `import { RedirectRefusedError,
// refuseRedirects } from "./index.js"` to resolve at runtime, the ROOT must export them — so
// they are surfaced here. Additive + browser-safe (both come from guarded-fetch's `.` entry).
export {
  classifyIpLiteral,
  createGuardedFetch,
  type DnsLookup,
  type GuardOptions,
  guardedFetch,
  isLoopbackAddress,
  isPublicAddress,
  RedirectRefusedError,
  type ResolvedAddress,
  refuseRedirects,
  SsrfError,
} from "@jeswr/guarded-fetch";
