---
name: solid-auth-core
description: Use when implementing browser Solid login with @jeswr/solid-auth-core, including WebID-first issuer discovery, DPoP login, pristine/public fetch separation, proactive authenticated fetch, silent restore, recent accounts, logout, or the React SessionProvider.
---
<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Work with `@jeswr/solid-auth-core`

Use `createSolidAuth()` instead of copying token-provider, login UX, restore, or React session code into an app.

```ts
import { createSolidAuth } from "@jeswr/solid-auth-core";

const auth = createSolidAuth({
  callbackUri,
  clientId,
  authFlow: { getCode },
  patchGlobalFetch: true,
});

await auth.restore();
await auth.login(webId);
await auth.authenticatedFetch(resourceUrl);
await auth.publicFetch(foreignUrl);
```

React consumers use `SessionProvider` and `useSolidSession()` from `@jeswr/solid-auth-core/react`.

## Preserve the credential boundary

- Keep pristine fetch capture first and pin every OIDC discovery, registration, token, and refresh request to it. Never route auth bootstrap traffic through a token-attaching global wrapper.
- Use `authenticatedFetch` only for allowed Solid resource origins and `publicFetch` for foreign/public origins.
- Keep the allowed-origin set fail-closed: HTTPS resource origins only, with explicit loopback HTTP opt-in for development. Do not add the issuer merely because it issued the token.
- Send every SDK-credentialed request with `redirect: "manual"`, overriding caller policy. The controller and proactive fetch wrapper check each visible redirect with the same live credential gate and mint a fresh URL/method/token-bound DPoP proof per hop; never use native redirect following for credentials.
- Use the shared Request-derivation helper for initial copies, buffering, manual passthrough/fallback, credential attachment, and followed hops. Preserve all caller-controlled Request settings (including referrer, referrerPolicy, mode, credentials, cache, integrity, keepalive, signal, and priority where supported) except the designed URL, redirect, credential-header, and method/body/content-header changes. Map inherited `mode: "navigate"` to `"same-origin"` when deriving with a non-empty init, per Fetch's constructor rule.
- Never attach or refresh SDK tokens for `mode: "no-cors"` requests, including direct `upgrade()` calls. Decide whether to force manual redirects from credential headers that survive Request construction, reading the constructed Request's headers. If browser header filtering removes all credentials, keep the caller's redirect policy.
- Force manual mode on every passthrough or fallback carrying caller-owned `Authorization`, `DPoP`, or `Proxy-Authorization`, from either init headers or a Request. Return every such redirect unfollowed, even on the same origin; the SDK cannot re-mint caller proofs. Credential-free passthrough and fallbacks keep the caller's original `follow`, `error`, or `manual` policy, including superseded upgrades and retries. Keep that policy on source requests and clones; derive manual requests only when attaching credentials. Let the transport handle credential-free redirects under the caller's policy.
- On SDK-authenticated hops that change origin, strip `Cookie`, `Cookie2`, `Proxy-Authorization`, `Authorization`, and caller `DPoP` before re-adding fresh SDK credentials. Same-origin hops preserve them before the SDK replaces its authorization and proof.
- Return foreign redirects and browser `opaqueredirect` responses unchanged. Browsers hide Location in manual mode, so credentialed redirects surface to their callers. Direct `upgrade()` users also receive manual Requests when credentials attach and must handle redirects themselves.
- Follow at most 20 hops. Apply Fetch's POST-to-GET 301/302 and non-GET/HEAD-to-GET 303 rewrites, dropping body/content headers including Content-Length. Buffer only non-stream `init.body` values before sending; check the abort signal before buffering, race reads against abort, cancel the reader on abort, and reject with the signal's reason (AbortError by default) without waiting for source cancellation. Treat Request bodies as streams and return redirects that require replaying a stream unfollowed.
- Cache resource-server nonces only under the checked hop's origin; a nonce retry must sign that hop's URL. Refuse a response nonce when its reported URL belongs to a different origin.
- When storage origins become known after restore, call `reArmAllowedOrigins()` rather than re-running the grant.
- Keep generation fences and per-session ownership checks around login, restore, refresh, logout, and persistence. Re-check after every awaited boundary before mutating live state.
- On any failure after arming a session, clear both the provider session and the authenticated-fetch boundary.
- Keep same-WebID login single-flight; reject concurrent login for a different WebID.

## Lifecycle rules

- Call `restore()` before showing the unauthenticated screen.
- Use `dropLiveSession()` for transient failures that should preserve the durable refresh credential.
- Use `logout()` for intentional sign-out or a definitive invalid grant; await durable cleanup before publishing logged-out state.
- Persist/rotate credentials before publishing authenticated state.
- Use `rememberAccount()` for display metadata instead of an app-local overlay.
- Prefer a stable Client Identifier Document and WebID-first login. If a profile advertises multiple issuers or storage roots, require an explicit choice.

This package is security-critical. Keep tests adversarial and non-vacuous, including cross-account switching, delayed stale operations, login-stall regression, pristine-fetch routing, foreign-origin refusal, DPoP nonce handling, and restore/logout races. Run the full gate.
