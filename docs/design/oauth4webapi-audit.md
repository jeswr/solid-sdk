<!-- AUTHORED-BY GPT-5 -->

# oauth4webapi overlap audit

Date: 2026-07-12

Scope: `solid-dpop`, `solid-openid-client`, `auth-solid`, `solid-api-auth`,
`solid-auth-core`, and `solid-webauthn-reauth`

Upstream baseline: `oauth4webapi` 3.8.6 at
[`1f6c4d4810225a88c94d74585f527ec30ea04f31`](https://github.com/panva/oauth4webapi/tree/1f6c4d4810225a88c94d74585f527ec30ea04f31)

## Conclusion

The bundle-size hypothesis is **not supported** for bundled applications. oauth4webapi is
dependency-free, publishes ESM with `"sideEffects": false`, and tree-shakes effectively despite
shipping one root module. The custom implementations instead come from package history, integration
seams, CJS/runtime compatibility, and application-specific orchestration.

The recommended actions are:

1. Replace the hand-written verifier in `solid-api-auth` with
   `validateJwtAccessToken` first. Its deliberate omission of `aud` validation is not RFC 9068
   conformant and is the highest-risk duplication.
2. Replace the protocol engine inside `solid-dpop` with oauth4webapi while preserving its CLI,
   loopback listener, session persistence, and fetch-facing API. Its current authorization-code
   path generates an OIDC nonce but never validates an ID token or that nonce.
3. Let `solid-openid-client` continue using `openid-client`, but replace its custom resource DPoP
   path with `openid-client.fetchProtectedResource` (which delegates to oauth4webapi).
4. In `auth-solid`, retain the Auth.js `customFetch` adapter because Auth.js owns the OAuth flow,
   but use oauth4webapi for the resource-request path and for supported DPoP primitives.
5. Keep the narrow request-decoration logic in `solid-auth-core` until oauth4webapi has a public
   “decorate this Request / mint a proof without sending” API with externally fed resource nonces.
6. Make no protocol change in `solid-webauthn-reauth`; it is already the best example in this set
   of using oauth4webapi for a custom grant and DPoP resource requests.

No `oauth4webapi-upstream-proposal.md` accompanies this audit. That deliverable was conditional on
tree-shaking being the blocker, and the measurements below falsify that condition. A subpath-export
proposal should be reconsidered only with a measured native/unbundled-ESM download or parse-cost
problem that bundling cannot solve.

## What oauth4webapi already exports

The upstream [README](https://github.com/panva/oauth4webapi#readme) lists discovery, authorization
code with PKCE, refresh and client-credentials grants, DPoP, protected-resource requests, DCR, and
incoming JWT access-token validation. The current
[`package.json`](https://github.com/panva/oauth4webapi/blob/1f6c4d4810225a88c94d74585f527ec30ea04f31/package.json)
has zero runtime dependencies, `sideEffects: false`, and only the root and `package.json` exports.

| Concern | Existing oauth4webapi surface |
|---|---|
| DPoP keys, proofs, `ath`, `htu`, thumbprint, nonce cache | `generateKeyPair`, `DPoP`, `DPoPHandle.calculateThumbprint`, `protectedResourceRequest`, DPoP options on token requests, `isDPoPNonceError` |
| PKCE | `generateRandomCodeVerifier`, `calculatePKCECodeChallenge` |
| State and OIDC nonce | `generateRandomState`, `generateRandomNonce`, `validateAuthResponse`, `processAuthorizationCodeResponse({ expectedNonce })` |
| Discovery and registration | `discoveryRequest`, `processDiscoveryResponse`, `dynamicClientRegistrationRequest`, `processDynamicClientRegistrationResponse` |
| Token endpoint | `authorizationCodeGrantRequest`, `refreshTokenGrantRequest`, `clientCredentialsGrantRequest`, `genericTokenEndpointRequest`, and matching response processors |
| JWKS and ID-token validation | JWKS retrieval/cache is integrated into the response processors; `jwksCache` and `customFetch` are public seams |
| `at+jwt` and DPoP verification | `validateJwtAccessToken(as, request, expectedAudience, { requireDPoP, signingAlgorithms, ... })` validates RFC 6750/9068/9449 core claims, signatures, `typ`, `aud`, `cnf.jkt`, `htm`, `htu`, `ath`, and proof freshness |

oauth4webapi intentionally does not provide an application replay store, authorization policy,
WebID validation, SSRF-safe profile resolution, session persistence, a loopback HTTP listener, or
request-body replay orchestration. Those remain suite responsibilities.

## Per-package summary

| Package | What is reimplemented | Why it exists | Recommendation |
|---|---|---|---|
| `solid-dpop` | Nearly the full client protocol: DPoP JWS/key/thumbprint/`ath`; PKCE; discovery; DCR; auth URL; client-credentials, code, and refresh token calls; state and DPoP nonce handling | Created as a canonical, `jose`-only, dual ESM/CJS SDK plus CLI/session orchestration. Its CJS build explicitly works around ESM loading on Node releases older than `require(esm)`. No source, README, manifest, or history reviewed here contains a bundle measurement or states that oauth4webapi tree-shaking was rejected. | **Replace with oauth4webapi**, preserving only orchestration, persistence, loopback transport policy, and compatibility adapters. |
| `solid-openid-client` | Only the resource-leg DPoP proof and nonce retry are custom; token-leg DPoP and OAuth/OIDC are delegated to `openid-client` | Its design explicitly says “wrap `openid-client`, don’t fork it” and reused `solid-dpop` to share an extractable/persistable key and resource fetch surface. The reason is API composition, not bundle size. | **Replace the custom resource leg** with `openid-client.fetchProtectedResource`; keep the high-level wrapper. |
| `auth-solid` | DPoP proof/key/thumbprint work and nonce retry in the Auth.js token `customFetch`; a second custom DPoP resource fetch | Auth.js owns its oauth4webapi-driven flow and exposes a fetch interception seam, but no provider-level DPoP handle. The adapter also enforces suite redirect refusal and replayable bodies. This is an integration constraint, not a size claim. | **Partial replacement**: keep the Auth.js adapter, replace supported proof/resource primitives with oauth4webapi, and retain suite transport/body rules. |
| `solid-api-auth` | JOSE/JWKS verification of `at+jwt`; complete DPoP proof verification; `ath`; JWK thumbprint; proof freshness and claim checks | Extracted from the AccessRadar reference implementation to mirror a pod verifier and deliberately accept pod-audience tokens at an app API. It already depends on oauth4webapi for discovery, so bundle size cannot explain the duplicate verifier. | **Replace urgently** with `validateJwtAccessToken`; keep allowlist-before-discovery, replay storage, WebID, SSRF, owner, and rate-limit policy. Add a real expected audience. |
| `solid-auth-core` | Only resource-request DPoP proof creation and per-origin resource nonce injection use the separate `dpop` package; OAuth/OIDC is already oauth4webapi | Its proactive fetch must return an upgraded `Request` without sending it, preserve allowed-origin policy, and accept a nonce learned from a later response. oauth4webapi's public resource API sends the request and does not expose a supported proof/decorator or nonce-feed operation. | **Keep this narrow custom adapter for now**; do not reimplement any more protocol. Revisit when the upstream public API fits the decorate-only lifecycle. |
| `solid-webauthn-reauth` | No OAuth/DPoP/JOSE primitive is reimplemented. Its base64url codec is for the package's WebAuthn assertion envelope, not JOSE. | It uses oauth4webapi discovery, generic token endpoint processing, DPoP keys/handle, nonce errors, and protected-resource requests. The remaining code is WebAuthn and RFC 8693 application protocol. | **Keep as-is** and use it as a migration reference. |

## Concern matrix

“Custom” means the package owns standards-sensitive logic that oauth4webapi already implements.
“Delegated” means the behavior comes from oauth4webapi, `openid-client`, or Auth.js. “N/A” means the
package has no such role.

| Package | DPoP proof creation | PKCE | Token endpoint calls | JWKS | `at+jwt` validation | Thumbprints | Nonce / state |
|---|---|---|---|---|---|---|---|
| `solid-dpop` | **Custom** with `jose`: proof JWS, `htm`, `htu`, `iat`, `jti`, `ath`, proof nonce, resource and token use | **Custom** SHA-256 and random verifier | **Custom** client credentials, code, refresh, Basic auth, response parsing, DPoP retry; also custom discovery and DCR | None; it does not validate ID tokens | None | **Custom wrapper** around `jose.calculateJwkThumbprint` | **Custom** state generation/check and DPoP nonce retry; OIDC nonce is generated and sent but never validated |
| `solid-openid-client` | Token leg **delegated**; resource leg **custom** through `solid-dpop` | **Delegated** to `openid-client` | **Delegated** to `openid-client` | **Delegated** for ID-token validation | N/A: client does not act as a resource server | Resource `dpop_jkt` comes from the custom `solid-dpop` wrapper; token handle delegated | State/OIDC nonce **delegated**; resource nonce retry **custom** |
| `auth-solid` | **Custom** in token fetch and resource fetch through `solid-dpop` | **Delegated** to Auth.js | Auth.js constructs/processes the request; custom fetch decorates and retries it | **Delegated** to Auth.js/oauth4webapi | N/A | **Custom wrapper** through `solid-dpop`; private JWK persisted by the package API | State/OIDC nonce **delegated**; DPoP nonce retry **custom** |
| `solid-api-auth` | **Custom verification** with `jose`, including embedded JWK signature and all proof claims | N/A | N/A | Discovery **delegated**; remote JWKS and key selection **custom** through `jose` | **Custom** `jwtVerify`; deliberately omits `aud` | **Custom** through `jose.calculateJwkThumbprint` | Custom `jti` replay store; no RS-nonce validation; state/OIDC nonce N/A |
| `solid-auth-core` | Token leg **delegated**; resource proof **custom** through `dpop.generateProof` | **Delegated** | **Delegated** for DCR, code, and refresh | **Delegated** for ID-token processing | N/A | **Delegated** through oauth4webapi's DPoP handle | State/OIDC nonce **delegated**; resource nonce cache **custom** because of decorate-before-send lifecycle |
| `solid-webauthn-reauth` | **Delegated** to oauth4webapi | N/A | **Delegated** through the generic token endpoint for RFC 8693 | Discovery delegated; token verification is server-side/out of scope | N/A | **Delegated** | DPoP nonce **delegated**; OIDC state/nonce N/A for redirect-free re-auth |

## Package details and security implications

### `@jeswr/solid-dpop`

The overlap is concentrated in [`dpop.ts`](../../packages/solid-dpop/src/dpop.ts),
[`authCode.ts`](../../packages/solid-dpop/src/authCode.ts), and
[`session.ts`](../../packages/solid-dpop/src/session.ts). `jose` supplies safe cryptographic
building blocks, but the package still owns standards-sensitive assembly, endpoint behavior, and
response validation.

The authorization-code path checks returned `state`, but `exchangeCode` accepts a token JSON body
without running an OIDC response processor. It does not validate an ID-token signature, issuer,
audience, or the nonce that `cliLogin` generated. It also does not enforce `token_type=DPoP` or
validate required token response fields before constructing a session. oauth4webapi's paired
request/response functions close these gaps.

What should remain custom: loopback listener, CLI browser callback, Solid default scopes, Client
Identifier Document selection, secure endpoint policy, session mutation/persistence, refresh hook,
and fetch-body/application ergonomics.

### `@jeswr/solid-openid-client`

[`client.ts`](../../packages/solid-openid-client/src/client.ts) already delegates discovery,
authorization response validation, PKCE, token response validation, JWKS/ID-token checks, refresh,
and token DPoP to `openid-client`. The duplicate is the resource-fetch closure plus
[`dpop.ts`](../../packages/solid-openid-client/src/dpop.ts). `openid-client` 6.8.4 exports
`fetchProtectedResource`, so the wrapper need not mint the resource proof itself.

The custom body buffering, abort handling, transport guard, and redirect-refusal behavior are
application policy. Preserve and test those around the panva call rather than treating them as a
reason to retain custom proof creation.

### `@jeswr/auth-solid`

[`provider.ts`](../../packages/auth-solid/src/provider.ts) correctly lets Auth.js generate and
validate PKCE, state, nonce, ID-token signature, issuer, and audience. Its
[`dpopFetch.ts`](../../packages/auth-solid/src/dpopFetch.ts) detects token requests by request body,
adds a proof, and performs the nonce retry because Auth.js has no provider option that accepts an
oauth4webapi DPoP handle.

That fetch interception is a legitimate adapter. It does not justify owning JWS construction. A
migration must verify that any replacement still uses Auth.js's exact request, client
authentication, body, abort signal, and redirect-refusal policy. The separately exported pod fetch
has no such ownership conflict and should move to oauth4webapi first.

### `@jeswr/solid-api-auth`

[`core.ts`](../../packages/solid-api-auth/src/core.ts) imports oauth4webapi for discovery and `jose`
for everything that `validateJwtAccessToken` would validate. The README's assertion that a DPoP
proof re-binds a pod-audience token to this API request does not make this API the token's intended
audience. DPoP proves possession and request binding; it does not replace the RFC 9068 resource
server audience check.

The replacement must construct a real `Request` using the package's proxy-aware reconstructed URL,
call `validateJwtAccessToken` only after checking the unverified issuer against the trusted list,
and supply the API's configured audience. After successful validation, the package may decode the
already-validated proof only to obtain its `jti` for the existing replay store, because
oauth4webapi validates `jti` presence/type but does not store or return proof claims. WebID and
owner authorization remain post-validation policy.

### `@jeswr/solid-auth-core`

[`controller.ts`](../../packages/solid-auth-core/src/controller.ts) is already an oauth4webapi
client for discovery, DCR, PKCE, state, nonce, code exchange, ID-token processing, refresh, and
token-endpoint DPoP. The remaining `dpop.generateProof` call upgrades a Request for a separately
installed proactive fetch and injects a nonce learned after the request completes.

oauth4webapi's `DPoPHandle.addProof` and `cacheNonce` exist on the TypeScript shape but are marked
internal/not public API. `protectedResourceRequest` is public but sends immediately. Depending on
those internals would exchange one maintenance risk for another. Keep this adapter narrowly scoped
and covered until upstream has a supported decoration lifecycle or the controller is redesigned to
let oauth4webapi send the request.

### `@jeswr/solid-webauthn-reauth`

[`WebAuthnTokenExchange.ts`](../../packages/solid-webauthn-reauth/src/client/WebAuthnTokenExchange.ts)
uses `genericTokenEndpointRequest`, `processGenericTokenEndpointResponse`, discovery, and
`isDPoPNonceError`. [`dpopBoundRequest.ts`](../../packages/solid-webauthn-reauth/src/client/dpopBoundRequest.ts)
uses `protectedResourceRequest` with a capture transport to obtain oauth4webapi-generated headers.
There is no custom JOSE code to replace.

## Tree-shaking and export-granularity verification

### Published structure

- One published runtime file: `build/index.js` (99,792 bytes unminified in 3.8.6).
- Root export only; there are no feature subpaths.
- ESM and `sideEffects: false`.
- Zero runtime dependencies.
- The source is one 6,795-line module. Named exports share internal helpers, so a bundler retains
  the requested functions and their reachable helper graph.

### Reproducible measurement

The audit bundled small entry modules with esbuild 0.25.12 using:

```sh
esbuild entry.mjs --bundle --format=esm --platform=browser --target=es2022 --minify
```

Each entry re-exported its imports to prevent the entry itself being eliminated. Gzip used level 9.

| Imported surface | Minified bytes | Gzip bytes |
|---|---:|---:|
| One function through `import * as oauth` (`generateRandomState`) | 1,840 | 949 |
| PKCE + state + nonce helpers | 2,547 | 1,242 |
| `DPoP`, key generation, nonce-error test, protected-resource request | 10,797 | 4,057 |
| `validateJwtAccessToken` | 16,599 | 5,911 |
| Discovery + code/client-credentials/refresh + DPoP client slice | 25,281 | 8,330 |
| Every oauth4webapi export | 49,718 | 14,211 |

This verifies that neither the single-file package nor namespace-import syntax forces the full
library into a modern optimized bundle. Granular subpath exports would not materially improve
these bundled results.

There is one qualified limitation: native browser ESM, a CDN that serves the file without
per-consumer rebundling, or Node direct ESM loads the whole 99.8 KB module and parses/evaluates its
top level. No audited package documents such a deployment or a measured startup/network problem.
That is insufficient evidence to ask upstream to split a deliberately low-level, dependency-free
module and maintain new subpath contracts.

## Evidence limits

This is a source and bundling audit, not a migration implementation. No package code was changed.
The “why” findings are based on manifests, READMEs, source comments, build scripts, and imported git
history present in this monorepo. Where those sources do not state a motive, this document says so
rather than inferring bundle size from the mere presence of custom code.
