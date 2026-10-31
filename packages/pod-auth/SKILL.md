---
name: pod-auth
description: Work on @jeswr/pod-auth, the suite client authentication and session lifecycle package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-auth

T-031 implements `createPodAuth`, injected UI hooks, provider composition, `fetch`, `login`, `identity`
and login/challenge event subscriptions. Read `README.md` for the supported core API and limitations.
Restore/logout/remembered policy, React hooks and Node/CID signing belong to later tasks; their subpaths
remain reserved. CID configuration without a private signing key must fail closed.

Before changing authentication policy, read SDK core ADR-001 D4 and `ADR-004-auth.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial
tests for every change. Use `./testing`'s mock OP over the real protocol engine. Test boundary exclusions,
UI cancellation, hint/identity mismatch, callbacks, provider ordering and shared-session fences.

Keep provider composition in `src/providers.ts`. Protocol logic stays in reactive-authentication;
never call `registerGlobally`. Capture the pristine transport and enforce loopback restrictions on
every protocol hop. Share the Solid session and its fence with UMA and the LWS OIDC source. Store only
refresh records persistently, namespace caller-provided stores, and propagate storage errors.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Build reactive-authentication before this package. Validate `lint`, `build`, `typecheck` and `test`;
run the root gate before committing the final change.
