---
name: pod-auth
description: Use when working on @jeswr/pod-auth, the suite client authentication and session lifecycle package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-auth

`createPodAuth` supplies injected UI hooks, provider composition, `fetch`, `login`, `identity`,
`restore`, `logout`, `remembered` and lifecycle event subscriptions. Read `README.md` for the API.
`./node` supplies `forClientCredentials` and `forCid` with explicit static roots and memory-only credentials.
CID mode (`lws.subject.cid`) requires a caller-provided non-extractable ES256 key; resolve and authorize
its exact same-document authentication method and prove key possession before releasing a credential.
Never infer a WebID from an opaque client-credentials token or fall back to OIDC for a failed CID identity.
`./react` supplies the thin `PodAuthProvider` / `usePodAuth` lifecycle mirror, ported from solid-auth-core.
Restore once across StrictMode replay, mirror lifecycle events, and fence late restore results against
newer events. Keep React optional and expose only identity plus stable public core actions.

Persist only refresh records with matching non-extractable ES256 keys, scoped by issuer/WebID/clientId.
Remembered pointers contain public metadata only. Restore refreshes under a Web Lock (keyed FIFO Node fallback)
and permits prompt=none only after invalid_grant, with no interactive fallback. Preserve credentials on
transient failures; discard invalid keys; propagate storage errors. Rotation must be durable before use.
Logout must revoke when advertised, purge across reloads, fence late results and emit even on failure.
The pure session-restore decision and tests are a verbatim port; preserve their behavior and attribution. CID configuration without a private signing key must fail closed.

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
