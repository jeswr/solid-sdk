<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

### Token-endpoint client auth: EXACT-host gates + a FAIL-CLOSED auth-method selection

Two security rules for any code that picks how a confidential client authenticates to the token
endpoint (the ESS `client_secret_basic` workaround, or `buildClientAuth` / `#clientAuth` in the
reference provider). Both are **fail-closed** rules — get them wrong and you mis-route a secret or
silently send no auth at all.

- **Match the issuer host EXACTLY — `new URL(issuer).hostname === "login.inrupt.com"`, never a
  substring `issuer.includes("login.inrupt.com")`.** A substring match is **spoofable** by a sibling
  or sub-path host: `https://login.inrupt.com.attacker.example`,
  `https://evil.example/login.inrupt.com/oidc`, `https://login.inrupt.com.example.com` all *contain*
  the substring, so a bespoke per-vendor workaround (here, the ESS non-URL-encoded Basic credential)
  would be sent to the **wrong server** — leaking a confidential `client_secret` in a non-standard
  header to an attacker-controlled OP. Parse the URL and compare `.hostname`; an unparseable issuer →
  `false` (never apply a vendor path to an unknown issuer). Trailing slash / path are then harmless
  (`https://login.inrupt.com/oidc` still matches on host), and the lookalikes above cannot.
- **Select the auth method FAIL-CLOSED — never silently downgrade to `none`.** A naive
  `if (method === "client_secret_basic") {…} else None()` treats EVERY unrecognised
  `token_endpoint_auth_method` as a public client, so a confidential client declaring
  `client_secret_jwt` / `private_key_jwt` / `tls_client_auth` is silently mis-authenticated — and on a
  server that *also* accepts public clients, succeeds-as-public when the user intended confidential
  auth. Instead: **THROW** on (a) a defined-but-unsupported method, and (b) a confidential method
  declared with no (or empty) secret. Two subtleties:
  - The OIDC/RFC-6749-§2.3.1 default for an **OMITTED** method is **`client_secret_basic` when a
    secret is present, `none` when it is not** — not unconditionally `none`. So a confidential client
    that omits the method must still present its secret (Basic), not silently drop it.
  - A **PRESENT-but-invalid** value (e.g. `null` from malformed/untrusted metadata) must NOT be
    coalesced to the omitted default — compare **`=== undefined`**, never `?? "none"`. `null ?? "none"`
    would accept a public path for a value that should fail closed. Apply the omitted-default only when
    the field is genuinely `undefined`; any other present value falls through to the unsupported-method
    guard and throws.

Cited — the cross-app security-parity rollout (2026-06): the hardened `buildClientAuth` /
`isEssNoUrlEncodeIssuer` / `isSupportedTokenEndpointAuthMethod` shipped in the pod-* apps'
`webid-token-provider.ts` (+ adversarial `webid-client-auth.test.ts`, which asserts the spoofed host
gets the SPEC encoder and that an unsupported method throws) and `@jeswr/solid-session-restore`'s
fail-closed `buildClientAuth`. The reference `webid-token-provider.ts` here carries the same hardened
helpers, with `webid-token-provider.test.ts` porting both the exact-host-spoof and fail-closed-method
cases.

### Deep-link autologin (`#autologin/<webid>` on load) — full-page redirect, enforce the WebID

A "send someone a link that logs them straight in as a known WebID" affordance (the pattern in
[media-kraken#54](https://github.com/NoelDeMartin/media-kraken/issues/54)) — an `#autologin/<webid>`
URL fragment that, on load, kicks off a Solid-OIDC login for that WebID — has a small set of
load-bearing constraints (learned wiring the Pod-suite apps, 2026-06):

- **Full-page redirect, not a popup.** A popup auto-opened on load has **no user gesture**, so the
  browser's popup blocker kills it — the autologin silently never starts. Drive the login as a
  **full-page** Solid-OIDC authorization redirect instead (the user *did* click the deep link, but
  that gesture is on the previous page and does not carry to the auto-open). Register **both**
  `${origin}/callback.html` (the popup target used by interactive login) **and** `${origin}/` (the
  full-page redirect lands back on the app root) in the client-id document's `redirect_uris` — miss
  the root and the IdP rejects the redirect.
- **Persist the flow secrets across the redirect.** A full-page redirect tears down the page, so the
  DPoP keypair (exported as a JWK — the *same* key must sign the eventual token-exchange proof), the
  **PKCE verifier**, the OAuth **state**, and the **nonce** all have to survive in `sessionStorage`
  and be re-read on return. (`sessionStorage`, not `localStorage`: scoped to the tab, cleared when it
  closes.)
- **ENFORCE the requested WebID — fail-closed before writing any state.** On return, the
  authenticated WebID from the returned **ID token** MUST equal the WebID the deep link asked for —
  compare with a normalising `webIdsEqual` (trailing-slash / fragment / case-of-host differences are
  real). If they differ, **throw before any session or issuer state is written.** The trap: a user
  may already have a *live IdP cookie session for a different account*; without this guard the
  autologin happily logs them in as the wrong WebID, which is a silent identity-confusion bug. This
  is the same fail-closed-on-WebID-mismatch principle as the per-attempt-token check above, applied
  to the deep-link return.
- **`prompt=none` so it's silent-with-fallback.** Set `prompt=none` on the authorization request so
  an already-logged-in user is bounced through silently; an OIDC error return (`login_required`,
  `interaction_required`) is then the signal to fall back to the normal interactive login. **Validate
  the OAuth `state` on the error/abort return too**, before consuming the persisted record — not only
  on the success path.
- **Seed BOTH the session AND the issuer before publishing.** Write the resolved issuer alongside the
  session so a later silent upgrade / refresh reuses it rather than re-resolving from scratch.

(Learned wiring the Pod-suite apps, 2026-06.)
