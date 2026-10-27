---
name: solid-auth-core
description: Use when implementing browser Solid login with @jeswr/solid-auth-core, including WebID-first issuer discovery, DPoP login, pristine/public fetch separation, proactive authenticated fetch, silent restore, recent accounts, logout, or the React SessionProvider.
---
<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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
- Send every upgraded request with `redirect: "manual"`, overriding caller policy. The controller and proactive fetch wrapper check each visible redirect with the same live credential gate and mint a fresh URL/method/token-bound DPoP proof per hop; never use native redirect following for credentials.
- Return foreign redirects and browser `opaqueredirect` responses unchanged. Browsers hide Location in manual mode, so credentialed redirects surface to their callers. Direct `upgrade()` users also receive manual Requests and must handle redirects themselves.
- Follow at most 20 hops. Apply Fetch's POST-to-GET 301/302 and non-GET/HEAD-to-GET 303 rewrites, dropping body/content headers. Buffer only non-stream `init.body` values before sending; treat Request bodies as streams and return redirects that require replaying a stream unfollowed.
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
