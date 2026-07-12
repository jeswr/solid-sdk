<!-- AUTHORED-BY GPT-5 -->

# oauth4webapi migration plan

Date: 2026-07-12

Companion audit: [oauth4webapi-audit.md](oauth4webapi-audit.md)

## Goal and constraints

Move standards-sensitive OAuth 2/OIDC/DPoP/JOSE behavior onto oauth4webapi without changing the
suite-specific trust model or silently weakening request handling.

This plan does **not** remove custom application policy. Trusted-issuer allowlists, WebID checks,
SSRF guards, owner authorization, replay stores, allowed-origin boundaries, redirect refusal,
bounded replay buffering, loopback listeners, and session persistence remain local.

All auth packages are security-critical in practice even where a manifest does not yet carry the
flag. Migrate one package at a time, run adversarial tests, and do not auto-merge.

## Compatibility decisions to make first

1. **Resource-server audience:** add a required expected-audience setting to `solid-api-auth`.
   Existing use of pod-audience tokens at an application API must be treated as a protocol/design
   migration, not preserved as compatibility.
2. **Node and CJS floor:** oauth4webapi is ESM. Its README supports CJS `require()` only where
   `require(esm)` is enabled by default (Node `^20.19.0`, `^22.12.0`, or `>=23`). Decide whether
   `solid-dpop` will raise its current `>=20.0.0` floor, use an async dynamic-import adapter in its
   CJS build, or drop CJS in a major release.
3. **Persisted DPoP keys:** retain exportable public/private WebCrypto keys where refresh-token
   persistence requires the same `jkt`. oauth4webapi `generateKeyPair("ES256", { extractable:
   true })` supports this; serialization remains suite code.
4. **Public API compatibility:** inventory exported `solid-dpop` types/functions and
   `solid-openid-client`'s `DpopKeyPair`. Preserve them through adapters where safe; schedule a major
   version only for shapes that cannot be represented without leaking obsolete implementation
   details.
5. **Fetch ownership:** distinguish functions that may let oauth4webapi send a request from adapters
   that must only decorate and return a `Request`. Do not call internal `DPoPHandle` methods as if
   they were supported API.

## Safe migration order

### 0. Freeze behavioral contracts

Before implementation:

- Add/confirm characterization tests for token response validation, issuer mismatch, duplicate
  callback parameters, state mismatch, ID-token nonce mismatch, non-DPoP downgrade, DPoP nonce
  retry limit, redirect refusal, abort propagation, and replayable body caps.
- Record bundle baselines for browser-facing entry points. The audit's esbuild measurements are the
  oauth4webapi baseline; package-specific baselines should use each package's real entry.
- Record the current public declaration surfaces and persisted session fixtures.
- Run `pnpm run gate` for a clean starting point.

### 1. Migrate `solid-api-auth` first

This package is independent of the two `solid-dpop` consumers and contains the most security-
significant duplicate.

1. Preserve the early unverified-`iss` allowlist check before discovery.
2. Resolve and cache `AuthorizationServer` metadata with existing custom fetch/loopback policy.
3. Reconstruct the externally visible request URL using the current proxy-trust rules, then create
   the exact `Request` passed to `validateJwtAccessToken`.
4. Call `validateJwtAccessToken` with `requireDPoP: true`, asymmetric `signingAlgorithms`, clock
   tolerance, JWKS cache/custom fetch, and the configured expected audience.
5. Only after successful validation, extract the proof `jti` for the existing atomic replay-store
   seam. Do not duplicate signature or proof-claim validation while extracting it.
6. Keep WebID syntax, bidirectional issuer, SSRF, owner, CSRF, rate-limit, and challenge mapping as
   post-validation policy.
7. Delete the direct `jose` verifier/JWKS/thumbprint/`ath` implementation when no longer referenced.

Required tests include wrong/missing `aud`, missing `client_id`/`jti`, wrong `typ`, `HS*`/`none`,
JWKS rotation/cache behavior, proof key mismatch, `ath` mismatch, replay, and proxy-aware `htu`.

### 2. Confirm `solid-webauthn-reauth` as the reference

No protocol migration is needed. Expand tests only if necessary to make its pattern reusable:

- generic RFC 8693 token request and response processing;
- exactly one retry after `isDPoPNonceError`;
- `DPoP`/`generateKeyPair` reuse across token and resource requests;
- protected-resource header capture without custom proof creation;
- protocol subpath remaining free of browser/runtime dependencies.

Do not fold the WebAuthn assertion-envelope codec into oauth4webapi concerns.

### 3. Migrate `solid-openid-client`'s resource leg

The OAuth/OIDC flow already belongs to `openid-client`.

1. Keep `openid-client.discovery`, authorization-code grant, refresh, ID-token checks, and its DPoP
   handle unchanged.
2. Replace `resourceDpopProof` and the manual DPoP header assembly with
   `openid-client.fetchProtectedResource`, using the same DPoP handle as the token endpoint.
3. Preserve the package's URL transport guard, reserved parameter guard, redirect refusal, body
   replay cap, abort semantics, Request/init precedence, and one-retry policy around the call.
4. Move consumers from the wrapper-specific thumbprint field to the DPoP handle's calculated
   thumbprint for `dpop_jkt`.
5. Decouple or adapt the exported `DpopKeyPair` persistence surface before removing the
   `solid-dpop` dependency.

Test that a restored key produces the same `jkt`, token and resource proofs share a key, query and
fragment are excluded from `htu`, and a rotated resource nonce is not sent cross-origin.

### 4. Reduce duplication in `auth-solid`

Auth.js must continue to own authorization response and token response processing.

1. Migrate `buildSolidDpopFetch` (pod/resource requests) to oauth4webapi's DPoP handle and
   `protectedResourceRequest` first.
2. Preserve the exact Auth.js `[customFetch]` request for the token leg. Explore using a supported
   oauth4webapi DPoP operation inside that adapter; do not replace Auth.js's token call with a
   second, independently constructed call.
3. If no supported operation can decorate the captured token request, retain the minimal proof
   adapter with a written seam rationale. Keep JWS construction isolated behind one function and
   shared with no other flow.
4. Preserve token-leg redirect refusal, original body/client authentication, transport checks,
   nonce retry, DPoP downgrade rejection, and private-key persistence.
5. Remove `solid-dpop` only after both token and resource paths no longer expose its runtime/types.

Integration tests must run the real Auth.js/oauth4webapi path against the faithful mock OP, including
public and confidential clients, nonce challenge, ID-token signature/nonce validation, and restart
with a persisted DPoP key.

### 5. Replace `solid-dpop` internals last

It has the widest custom surface and two direct consumers, so migrate it only after those consumers
have reduced their coupling.

1. Replace custom discovery with `discoveryRequest`/`processDiscoveryResponse` while retaining the
   suite's endpoint transport checks and custom fetch.
2. Replace DCR with the paired dynamic registration functions.
3. Replace random state, nonce, verifier, and PKCE challenge generation with oauth4webapi helpers.
4. Keep authorization URL construction as orchestration, but use oauth4webapi-generated values and
   `DPoPHandle.calculateThumbprint` for `dpop_jkt`.
5. Replace code, refresh, and client-credentials POSTs and JSON casting with paired request/response
   processors and one bounded `isDPoPNonceError` retry.
6. Require and validate the ID token in the user-delegated OIDC path, including signature, issuer,
   audience, and expected nonce. Reject absent/wrong `state` before token exchange.
7. Replace resource proof creation with `protectedResourceRequest`; retain the public fetch adapter,
   body handling, redirect refusal, and session nonce behavior as needed.
8. Preserve session serialization and verify that import/export round trips keep the same
   thumbprint and refresh-token binding.
9. Remove `jose` after confirming no public JWK serialization type requires it. WebCrypto JWK types
   can remain structural types.

Run live CSS authorization-code, refresh-rotation, client-credentials, DCR, Client Identifier
Document, CJS/ESM, and persisted-session tests before release.

### 6. Leave `solid-auth-core` narrow and explicit

No broad migration is needed; it already uses oauth4webapi.

- Keep oauth4webapi for discovery, DCR, PKCE, state, nonce, authorization code, refresh, ID-token
  validation, and token-endpoint DPoP.
- Keep the current resource Request-upgrade adapter only while it must produce an unsent Request and
  inject a separately observed resource nonce.
- Do not consume `DPoPHandle.addProof` or `cacheNonce` directly; upstream marks them internal.
- Re-evaluate the separate `dpop` dependency if oauth4webapi adds a supported decorate/proof API, or
  if proactive fetch can be redesigned so oauth4webapi owns the send.

Tests must continue to cover allowed-origin boundaries, login/logout races, nonce scoping, forced
refresh, query/fragment normalization, and proactive global-fetch installation.

### 7. Cleanup and release validation

After each package migration:

1. Run its filtered lint, build, typecheck, and tests plus dependents.
2. Inspect the emitted ESM and declarations for accidental workspace/private-type leakage.
3. Compare minified and gzip bundle baselines; investigate regressions rather than assuming the root
   oauth4webapi import is the cause.
4. Run roborev and address every auth/security finding.

At the end:

- remove unused `jose`, `dpop`, and `solid-dpop` edges only after `pnpm run check:packages <name>`
  policy checks for any newly direct dependency;
- run the full `pnpm run gate`;
- run all live/mock OP integrations and persisted-session fixtures;
- verify `suite.json` and package READMEs describe the new ownership accurately;
- publish no mirrors until the full workspace gate is green and mirror publishing is separately
  authorized.

## Rollback boundaries

Each package migration should be one independently revertible commit. Do not combine the
`solid-api-auth` audience contract change with unrelated client migrations. Keep compatibility
adapters for one release where public key/session types change. A rollback must restore the prior
package implementation and its dependency edge together; never leave half-migrated proof creation
paired with a different nonce/key store.

## Completion criteria

The migration is complete when:

- no package manually verifies an access-token or DPoP JWS that oauth4webapi can validate;
- no package manually constructs standard token endpoint requests/responses that oauth4webapi
  supports;
- the only remaining proof-decoration code has a documented unsupported-upstream seam;
- every OIDC flow validates state, issuer, audience, signature, and nonce as applicable;
- every resource server validates its own audience and retains replay protection;
- bundle measurements remain within agreed budgets; and
- the full gate, adversarial tests, live integrations, and roborev all pass.
