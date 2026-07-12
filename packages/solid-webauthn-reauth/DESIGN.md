# Design notes — `@jeswr/solid-webauthn-reauth`

> AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.

This records the design decisions behind the package so they are reviewable
after the fact (the suite's *proceed-without-greenlight* rule). Corrections
welcome.

## 1. What this is

A reusable extraction of the maintainer's proven **redirect-free WebAuthn
re-authentication** flow for Solid-OIDC:

- The **app is the WebAuthn Relying Party**; the resource server (pod) is
  **untouched** — it keeps trusting the OP via the existing `solid:oidcIssuer`
  triple.
- After a normal login the app **registers** an origin-bound passkey with the
  user's OP. Thereafter it **re-authenticates without a redirect**: fetch a
  challenge, run the `navigator.credentials.get` ceremony in the app, relay the
  assertion to the OP as an **RFC 8693 token exchange**
  (`subject_token_type = urn:solid:token-type:webauthn-assertion`), and get back
  ordinary **DPoP-bound Solid-OIDC tokens** (RFC 9449).
- Because the credential is origin-bound and the browser refuses to release it
  for any other origin, one assertion attests **both** the user (holds the
  authenticator) **and** the app (its origin is signed into `clientDataJSON`).

Two facts fix the architecture (from the source `spec/ARCHITECTURE.md`):
**F1** — the app must be the RP, so the ceremony runs in the app and the OP
verifies a *relayed* assertion; **F2** — a WebAuthn key cannot sign HTTP
requests, so this is a challenge-response *login* primitive, not per-request
signing.

## 2. Package-boundary decision (the main call)

**Chosen: a new standalone single-purpose repo `@jeswr/solid-webauthn-reauth`,
self-contained and GitHub-installable, with two exports:**

- `.` — the **browser client** (passkey registration + redirect-free re-auth
  provider + DPoP binding). ESM-only.
- `./protocol` — the **pure, isomorphic wire-format contract** (URNs, the
  base64url + assertion-bundle codec, and origin helpers) for an IdP verifier.
  ESM **and** CJS.

### Alternatives considered

1. **Contribute into the existing `jeswr/solid-webauthn` monorepo** (which
   already holds `packages/client` = `@jeswr/solid-webauthn-client` +
   `packages/protocol`). *Rejected as the delivery vehicle* because that monorepo
   is a design-first research workspace: its client depends on the protocol via
   an npm-workspace `"*"` reference, ships **no** committed `dist/`, no CJS build,
   no `suite.json`, and is **not** GitHub-installable under `ignore-scripts=true`.
   The suite apps consume packages via `github:jeswr/<repo>#main` with a committed
   self-contained `dist/` — exactly the shape of the named siblings
   `@jeswr/solid-dpop` and `@jeswr/solid-session-restore`. A standalone repo is
   the only thing that satisfies the bead's "a reusable @jeswr library the suite
   apps can consume." The monorepo remains the home of the **server** component
   (`@jeswr/css-webauthn`) and the normative spec.

2. **Depend on the off-npm `@jeswr/solid-webauthn-protocol`** rather than inline
   it. *Rejected*: that package is not on npm and lives behind a workspace `*`
   dep, so a `github:` install could not resolve it. The protocol module is
   tiny, dependency-free, and jointly authored — inlining it (as other suite
   packages inline `@jeswr/fetch-rdf`) makes this artifact self-contained. The
   inlined copy is the single source within this repo; upstream drift is a
   follow-up (see §6).

3. **DPoP via `@jeswr/solid-dpop` (peer/inlined) instead of `oauth4webapi`.**
   *Rejected for now.* The proven re-auth flow uses `oauth4webapi`'s `DPoPHandle`
   for three load-bearing behaviours: (a) one keypair shared between the
   token-endpoint proof and the resource proof (RFC 9449 sender-constraint
   continuity), (b) automatic `htu`/`ath` computation on
   `protectedResourceRequest`, and (c) the `use_dpop_nonce` retry via
   `isDPoPNonceError`. `@jeswr/solid-dpop` is jose-based and does not expose an
   equivalent handle, so composing it would mean re-implementing that
   security-critical glue by hand — the opposite of "no hand-rolled crypto, use
   vetted libs." `oauth4webapi` is a vetted, widely-used, already-in-suite
   dependency (`@jeswr/solid-session-restore` depends on it). A `@jeswr/solid-dpop`
   adapter is a possible future seam, not a v1 requirement. The suite
   relationship the bead asks for ("complements solid-dpop / solid-session-restore")
   is expressed in `suite.json` `dependsOn`, docs, and the shared DPoP concepts —
   not a forced runtime dependency.

4. **Dual ESM+CJS for the whole package.** *Rejected for `.`.* `oauth4webapi` is
   **ESM-only** (`"type":"module"`, no `require` condition); a CJS build that
   `require("oauth4webapi")` would throw `ERR_REQUIRE_ESM` on Node without
   `require(ESM)`. The named sibling `@jeswr/solid-session-restore` is ESM-only
   for the same reason. So `.` is ESM-only (all its consumers — PM/Next.js, the
   vite pod-apps, browsers — are ESM). To still honour "esm+cjs" and "server/IdP
   helper behind a subexport," the **pure `./protocol`** layer — which has no
   `oauth4webapi`/`@simplewebauthn/browser` runtime dependency (the latter is a
   type-only import, erased at build) — ships **dual ESM+CJS**, so a Node IdP
   verifier can `require('@jeswr/solid-webauthn-reauth/protocol')`.

## 3. What is reused vs new

- **Reused logic-for-logic** from the jointly-authored monorepo: the re-auth
  provider (`WebAuthnTokenProvider`), the acquisition strategy
  (`WebAuthnTokenExchange`), the DPoP binding (`dpopBoundRequest`), the
  `TokenProvider`/`TokenExchange` interfaces, and the protocol codec/origin/
  constants. Dual copyright (Samu Lang + Jesse Wright) and SPDX headers preserved.
- **New**: `registerPasskey` — the app-side registration ceremony was previously
  only inline in the monorepo demo (`packages/sample-app/app.js`). Here it is a
  clean, fail-closed, unit-tested helper with an injectable authenticated-fetch
  seam. Also new: `isAllowedOrigin` (a fail-closed convenience over the origin
  helpers), and the whole suite scaffold.

## 4. Threat model (5 bullets)

1. **Phishing / origin spoofing.** The security property is that the browser
   binds the assertion to the app's origin (`clientDataJSON.origin`) and won't
   release the credential to another origin. The **OP** enforces
   `origin ∈ allowedOrigins(client_id)` on verify (this library ships the
   `normaliseOrigin`/`allowedOriginsFor`/`isAllowedOrigin` helpers so the verifier
   uses the *same* normalisation — never a raw `origin === client_id` compare).
   The client cannot and does not self-attest; it only relays. **The OP is the
   trust anchor; this library is client-side and does not weaken it.**
2. **Token downgrade / confused-deputy.** The exchange **refuses a non-DPoP
   token** (`token_type !== "dpop"` throws) so a Bearer token is never carried
   with an `Authorization: DPoP` header. One DPoP keypair binds both the
   token-endpoint proof and the resource proof (verified by test), preventing a
   key-split that would break sender-constraint continuity.
3. **Untrusted input on the verifier surface.** `decodeAssertionBundle` (the
   function an IdP runs on the untrusted `subject_token`) is **fail-closed and
   structural-only**: bad base64url / non-JSON / non-object / wrong version →
   `MalformedBundleError`; every field the verifier later reads is presence- and
   base64url-validated *before* any crypto, so a malformed credential is a clean
   `invalid_request`, not a deeper exception. Cryptographic verification remains
   the OP's job (out of scope here).
4. **Credential handling during registration.** `registerPasskey` never touches
   the login credential: the caller injects an authenticated `fetch`; the library
   only relays JSON to the OP's authenticated endpoints. It forces a resident /
   discoverable key (needed for the discoverable re-auth flow) and fails closed on
   any non-2xx OP response or malformed options payload — no partial state. It
   builds a fresh creation-options object rather than mutating the OP's payload.
5. **Replay / challenge freshness / revocation.** These are **OP-side** controls
   (single-use challenge cache, `signCount`, credential revocation) and are
   deliberately out of scope for this client library — documented so a consumer
   does not assume the client provides them. The client mints a fresh DPoP key and
   runs a fresh ceremony on every `upgrade` (stateless — `invalidate` is a no-op),
   so there is no client-cached secret to steal or replay.

## 5. Non-goals

- No server / OP verifier implementation (that is `@jeswr/css-webauthn` in the
  monorepo). This package ships only the shared *wire contract* an IdP reuses.
- No per-request WebAuthn signing (F2). No trust statements issued back to the
  app. No keys in the WebID.

## 6. Follow-ups

- **Upstream reconciliation**: the inlined protocol is a copy of
  `jeswr/solid-webauthn` `packages/protocol`. If that spec evolves, re-sync. A
  cleaner long-term option is to publish the protocol package to npm and depend
  on it; until then, inlining keeps this artifact self-contained.
- **Optional `@jeswr/solid-dpop` adapter** (alternative 3) if a jose-only DPoP
  path is wanted.
- **v2 origin rule**: accepting origins *declared inside* the Client ID Document
  (needs a proof-of-control mechanism) — tracked in the source spec, out of scope
  for v1.
