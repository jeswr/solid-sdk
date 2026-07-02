# @jeswr/solid-webauthn-reauth

**Redirect-free Solid-OIDC re-authentication with a WebAuthn (passkey)
assertion.** The application is the WebAuthn Relying Party, the resource server
(pod) is **untouched**, and a single origin-bound assertion attests **both** the
user (who holds the authenticator) and the app (whose origin the browser signs
into the assertion).

Complements [`@jeswr/solid-dpop`](https://github.com/jeswr/solid-dpop) (DPoP
proof primitives) and
[`@jeswr/solid-session-restore`](https://github.com/jeswr/solid-session-restore)
(silent refresh-token restore): together they give a Solid app a fast, low-prompt
login lifecycle.

> Extracted from the maintainer's `jeswr/solid-webauthn` work (jointly authored
> with Samu Lang). See [`DESIGN.md`](./DESIGN.md) for the package-boundary
> decision, alternatives, and the threat model.

## How it works

After a normal Solid-OIDC login, the app **registers** a passkey bound to its own
origin with the user's OpenID Provider (the OP stores the public key against
⟨WebID, ClientID⟩). Thereafter the app **re-authenticates without an interactive
redirect**:

```
app → OP   POST /.oidc/webauthn/assertion-options        (fetch a single-use challenge)
app        navigator.credentials.get(...)                 (the passkey ceremony, in the app)
app → OP   POST /.oidc/token  grant_type=token-exchange   (RFC 8693, subject_token = assertion)
                              subject_token_type=urn:solid:token-type:webauthn-assertion + DPoP
OP  → app  { access_token (DPoP), token_type: "DPoP" }    (ordinary Solid-OIDC + DPoP, RFC 9449)
app → pod  Authorization: DPoP <token> + DPoP proof       (resource server unchanged)
```

Two facts fix the design: (**F1**) a WebAuthn assertion's origin is bound by the
browser to the RP, so the ceremony must run **in the app** and the OP verifies a
*relayed* assertion — which is what also makes the assertion attest the app;
(**F2**) a WebAuthn key cannot sign HTTP requests, so this is a challenge-response
**login**, not per-request signing. DPoP provides the sender-constraint.

## Install

GitHub-installable now (npm publish deferred). The package commits a built,
self-contained `dist/`, so it imports with no build step under
`ignore-scripts=true`:

```bash
npm install github:jeswr/solid-webauthn-reauth#main
# runtime deps (both on npm) are installed normally:
#   @simplewebauthn/browser  oauth4webapi
```

## Usage

### 1. Register a passkey (once per app + device, after a normal login)

`registerPasskey` runs the `navigator.credentials.create` ceremony in the app and
stores the credential with the OP. Pass an **authenticated** `fetch` carrying the
post-login account session — the library never touches the login credential.

```ts
import { registerPasskey } from "@jeswr/solid-webauthn-reauth";

const { credential } = await registerPasskey({
  registerOptionsUrl: "https://op.example/.account/webauthn/register-options",
  registerUrl:        "https://op.example/.account/webauthn/register",
  clientId:           "https://app.example/clientid.jsonld", // your Client ID Document URI
  fetch:              authenticatedFetch, // carries the account session
  // webId is optional — the OP may derive it from the session
});
```

A **resident / discoverable** credential is forced by default (the discoverable
re-auth flow sends an empty `allowCredentials`, so the authenticator must find the
passkey with no hint). Set `requireResidentKey: false` only for a deployment that
always sends `allowCredentials`.

### 2. Re-authenticate without a redirect

`WebAuthnTokenProvider` implements the
[`@solid/reactive-authentication`](https://github.com/solid-contrib/reactive-authentication)
`TokenProvider` contract (`matches` / `upgrade` / `invalidate`), so it drops into
an app's existing `TokenProvider[]` pipeline — ordering controls precedence, first
`matches` wins.

```ts
import { WebAuthnTokenProvider } from "@jeswr/solid-webauthn-reauth";

const provider = new WebAuthnTokenProvider({
  // keyed by the RESOURCE host it should handle
  "pod.example": {
    issuer: "https://op.example",
    // optional — these default to the conventional/discovered endpoints:
    assertionOptionsEndpoint: "https://op.example/.oidc/webauthn/assertion-options",
    tokenEndpoint:            "https://op.example/.oidc/token",
    clientId:                 "https://app.example/clientid.jsonld",
  },
});

// On a 401, the reactive-auth manager calls upgrade(); or drive it directly:
const upgraded = await provider.upgrade(new Request("https://pod.example/resource"));
const res = await fetch(upgraded); // Authorization: DPoP <token> + a DPoP proof
```

On each `upgrade` the provider mints **one** DPoP keypair (shared between the
token-endpoint proof and the resource proof — RFC 9449 sender-constraint
continuity), runs a fresh assertion ceremony, exchanges it (RFC 8693, retrying
once on a `use_dpop_nonce` challenge), and **refuses a non-DPoP token**. Re-auth
is stateless, so `invalidate` is a no-op.

### 3. The wire contract, for an IdP verifier

The pure, isomorphic protocol layer is a separate subexport with **no**
`oauth4webapi`/`@simplewebauthn/browser` runtime dependency, shipped as **ESM +
CJS** so a Node OP verifier can consume it either way:

```ts
import {
  decodeAssertionBundle,   // fail-closed, structural-only decode of subject_token
  MalformedBundleError,
  isAllowedOrigin,         // origin ∈ allowedOrigins(client_id) — the phishing gate
  normaliseOrigin,
  allowedOriginsFor,
  WEBAUTHN_ASSERTION_TOKEN_TYPE,
  TOKEN_EXCHANGE_GRANT_TYPE,
  BUNDLE_VERSION,
} from "@jeswr/solid-webauthn-reauth/protocol";
```

Cryptographic verification of the inner WebAuthn assertion, challenge freshness /
single-use, `signCount`, and revocation are the **OP's** responsibility — this
package provides the shared wire contract, not the verifier.

## Module formats

| Export | Formats | Why |
| --- | --- | --- |
| `.` (browser client) | **ESM only** | depends on `oauth4webapi` (ESM-only); every consumer (Next.js / vite / browser) is ESM |
| `./protocol` (wire contract) | **ESM + CJS** | pure, dependency-free — usable from a CJS Node IdP verifier |

## API surface

**`@jeswr/solid-webauthn-reauth` (`.`, ESM)**

- `registerPasskey(options): Promise<RegisterPasskeyResult>` — the registration
  ceremony (+ types `RegisterPasskeyOptions`, `RegisterPasskeyResult`,
  `AuthenticatedFetch`).
- `WebAuthnTokenProvider` — the redirect-free re-auth `TokenProvider`.
- `WebAuthnTokenExchange` — the acquisition Strategy (types `WebAuthnConfig`,
  `WebAuthnIssuerConfig`).
- `dpopBoundRequest(request, accessToken, dpop)` — attach a resource-bound DPoP
  proof + `Authorization: DPoP`.
- interfaces `TokenProvider`, `TokenExchange`, `TokenExchangeContext`.
- re-exports of the whole `./protocol` surface for convenience.

**`@jeswr/solid-webauthn-reauth/protocol` (ESM + CJS)**

- `encodeAssertionBundle` / `decodeAssertionBundle` / `MalformedBundleError`.
- `normaliseOrigin` / `allowedOriginsFor` / `isAllowedOrigin`.
- `encodeBase64url` / `decodeBase64url`.
- constants `WEBAUTHN_ASSERTION_TOKEN_TYPE`, `TOKEN_EXCHANGE_GRANT_TYPE`,
  `BUNDLE_VERSION`.
- types `AssertionBundle`, `AssertionOptions`, `RegistrationBundle`,
  `RegistrationOptions`, and the underlying SimpleWebAuthn JSON types.

## Security

WebAuthn ceremonies use the platform API via `@simplewebauthn/browser`; DPoP
proofs use `oauth4webapi` (RFC 9449). **No hand-rolled crypto.** The threat model
and the fail-closed guarantees are in [`DESIGN.md`](./DESIGN.md) §4. In short: the
OP is the trust anchor (origin check, challenge freshness, signature, revocation);
this library is client-side and does not weaken it, refuses token downgrade, and
fail-closes on malformed input on the verifier-facing decode surface.

## Development

```bash
npm run gate   # lint (biome) + typecheck (tsc) + test (vitest) + build + check:dist
```

The committed `dist/` must match a fresh build — `check:dist` fails on drift; run
`npm run build` and commit after any `src/` change.

## License

MIT © 2026 Samu Lang, Jesse Wright.
