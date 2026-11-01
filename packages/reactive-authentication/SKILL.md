---
name: reactive-authentication
description: Maintain the imported @jeswr/reactive-authentication protocol engine, token providers, credential boundaries, persistent caches, browser elements and service-worker bridge.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Maintain the authentication protocol engine

Experimental — AI-agent-generated workspace integration of `jeswr/reactive-authentication-ai`.
This package supplies protocol primitives; suite session policy belongs in `@jeswr/pod-auth`.

Read `README.md`, `docs/architecture.md`, and `docs/protocols.md` before changing protocol behavior.
The public entry points remain `.`, `./elements`, `./registerElements`, and `./service-worker`.
`registerElements` has registration side effects. The core entry point must remain usable in Node.

- Inject transport, credential boundaries, providers and stores. Preserve the pristine fetch seam.
- Keep credentials within verified storage boundaries; reject stale operations after logout or account changes.
- Preserve non-extractable DPoP keys, refresh rotation, session fences and cross-tab locking.
- RFC 9728 LWS discovery is supported; legacy `as_uri`/`realm` challenges are behind
  `legacyLwsChallenge` (default true). Validate PRM origin/resource, StorageRoot and AS metadata before
  obtaining any subject credential. Reuse this package's StorageContext discovery; add no workspace dependencies.
- Do not add suite login policy or global registration as part of import maintenance.
- Build before typechecking consumers: `pnpm --filter @jeswr/reactive-authentication run build`.
- Run lint, build, typecheck and test for this package. Vitest runs the imported protocol and harness
  tests against local fixtures and enforces 100% coverage for this security-critical package.
- Browser suites remain explicit `test:browser` and `test:browser:regressions` commands and need
  installed Playwright browsers. Live interoperability commands require configured external targets.
