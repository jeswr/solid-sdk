// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Codex GPT-6.1-Sol
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
// This internal adapter keeps the guard available to federation-client's implementation.
// The public root exposes only SsrfError, RedirectRefusedError and the DnsLookup /
// GuardOptions / ResolvedAddress types. Import general guard helpers directly from
// `@jeswr/guarded-fetch`. The build shares one bundled guard between `.` and `./node`
// through a private chunk, preserving the error classes without public helper re-exports.
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
