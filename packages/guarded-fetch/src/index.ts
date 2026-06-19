// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/guarded-fetch` — SSRF / DNS-rebinding-guarded fetch for the @jeswr Solid suite.
 *
 * The default `.` entry is BROWSER-SAFE (no top-level `node:` import): an https-only,
 * no-userinfo, private/loopback/link-local/metadata-blocking policy core with per-resolved-
 * record DNS-rebinding re-check, a manual-redirect re-validation loop (cross-origin credential
 * + body strip), a response-size cap + timeout, an injectable-fetch seam, and a Node-vs-browser
 * branch selected by capability detection. The IP-literal classification is delegated to the
 * vetted `ipaddr.js` (bundled into `dist/`); the policy is small reviewed custom code.
 *
 * The OPT-IN `./node` entry (`@jeswr/guarded-fetch/node`) adds the full undici DNS-pinning fetch
 * that closes the lookup→connect TOCTOU on the server side. It is the ONLY artifact that
 * imports `undici` / `node:*`, so the default entry's browser bundle is unaffected.
 *
 * Consolidated from the suite's three divergent copies (federation-client, solid-community-feeds,
 * solid-agent-notify) plus the prod-solid-server `@pss/guarded-fetch` reference; the consolidated
 * guard is a strict SUPERSET of every defence any one of them had.
 */
export {
  classifyIpLiteral,
  isLoopbackAddress,
  isPublicAddress,
} from "./addresses.js";
export {
  assertSafeUrl,
  createGuardedFetch,
  DEFAULT_HOSTNAME_DENYLIST,
  type DnsLookup,
  GuardError,
  type GuardOptions,
  guardedFetch,
  isDeniedHostname,
  normalizeHostForClassification,
  type ResolvedAddress,
  SsrfError,
} from "./guard.js";
