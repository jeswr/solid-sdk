---
name: reactive-authentication
description: Use when maintaining the imported @jeswr/reactive-authentication protocol engine, token providers, credential boundaries, persistent caches, browser elements and service-worker bridge.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Maintain the authentication protocol engine

Experimental — AI-agent-generated workspace integration of `jeswr/reactive-authentication-ai`.
This package supplies protocol primitives; suite session policy belongs in `@jeswr/pod-auth`.

Read `README.md`, `docs/architecture.md`, and `docs/protocols.md` before changing protocol behavior.
The public entry points remain `.`, `./elements`, `./registerElements`, and `./service-worker`.
`registerElements` has registration side effects. The core entry point must remain usable in Node.

- Inject transport, credential boundaries, providers and stores. Preserve the pristine fetch seam.
- `createServerOidcClient` verifies the WebID-to-issuer profile binding by default for callback and
  refresh ID tokens against validated `iss`, including the HTTPS `sub` fallback. Verification
  requires a separate SSRF-guarded `profileFetch` before discovery; there is no raw-fetch fallback.
  That transport must pin public DNS answers, reject private/loopback targets on every hop and
  honor AbortSignal. Turtle-only profiles have a 256 KiB streaming cap and a single eight-second
  deadline across redirects and body reading. `verifyWebId: false` is for callers that independently
  verify that binding (including fetch-rdf content negotiation). Profile failure after refresh may
  discard an already rotated refresh token: require new login, or opt out, persist rotation and
  perform the guarded verification before permitting resource access.
  Its optional `allows(URL)` predicate rejects resource URLs before buffering and before each resource send (including retries); without it there is no
  resource boundary. Discovery/exchange use `fetch`; profiles use `profileFetch` separately.
  `lws: true` requires `trustAuthorizationServer`; reject missing policies before discovery.
- Keep credentials within verified storage boundaries; reject stale operations after logout or account changes.
- Revalidate the captured fence generation after credential-store reads. `OidcSession.identity()` reports
  `undefined` when logout supersedes a pending read, while unrelated store errors still propagate.
- Preserve non-extractable DPoP keys, refresh rotation, session fences and cross-tab locking.
- Preservation-mode refresh rotation replaces the durable record in one write inside its fence commit.
  Never remove it before replacement: unlocked presence readers would observe a false expiry. On a
  failed replacement, remove the consumed credential and propagate the failure.
- `OidcSessionOptions.revocationSignal` cancels pending revocations and deadlines on owner disposal.
  Remove its listeners on settlement; cancellation alone never purges retained session stores.
- RFC 9728 LWS discovery is supported; legacy `as_uri`/`realm` challenges are behind
  `legacyLwsChallenge` (default true). Validate PRM origin/resource, StorageRoot and AS metadata before
  obtaining any subject credential. Reuse this package's StorageContext discovery; add no workspace dependencies.
- Do not add suite login policy or global registration as part of import maintenance.
- Build before typechecking consumers: `pnpm --filter @jeswr/reactive-authentication run build`.
- Run lint, build, typecheck and test for this package. Vitest runs the imported protocol and harness
  tests against local fixtures and enforces 100% coverage for this security-critical package.
- Browser suites remain explicit `test:browser` and `test:browser:regressions` commands and need
  installed Playwright browsers. Live interoperability commands require configured external targets.
