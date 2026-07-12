---
name: solid-auth-core
description: Use when implementing browser Solid login with @jeswr/solid-auth-core, including WebID-first issuer discovery, DPoP login, pristine/public fetch separation, proactive authenticated fetch, silent restore, recent accounts, logout, or the React SessionProvider.
---
<!-- AUTHORED-BY Codex GPT-5 -->

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
