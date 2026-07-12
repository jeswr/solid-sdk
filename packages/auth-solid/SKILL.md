---
name: auth-solid
description: Use when integrating Solid-OIDC with Auth.js or next-auth v5 through @jeswr/auth-solid, persisting the DPoP-bound Auth.js JWT state, or making authenticated pod requests with solidDpopFetch.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Work with `@jeswr/auth-solid`

Use this package only when Auth.js owns the OAuth/OIDC orchestration. It injects Solid's required DPoP behavior through Auth.js's `customFetch` seam.

## Integration outline

1. Install an `@auth/core` version in the declared peer range; `customFetch` requires `>=0.37.0`.
2. Build `await Solid({ issuer, clientId, ... })` once at module load.
3. Keep Auth.js checks for PKCE S256, state, and nonce enabled.
4. In the JWT callback, persist `persistSolidTokensIntoJwt({ account, dpopKeyJwk, webid, issuer })` under `SOLID_JWT_KEY`.
5. Expose only the verified WebID to the client session.
6. On the server, call `extractSolidAuthState()` and construct `solidDpopFetch(state)` for pod requests.

## Security rules

- Read identity only from the verified ID-token claims passed to `profile()`. Never trust a WebID from the access token.
- Attach token-endpoint DPoP through the package custom fetch. Token-endpoint proofs omit `ath`; resource proofs include it.
- Keep nonce retries capped at one. Preserve the request-body replay limit for retryable streamed requests.
- Reject cleartext transport except explicitly allowed loopback development.
- Treat the persisted access token, refresh token, ID token, and private DPoP JWK as secrets.
- With JWT sessions, set a strong `AUTH_SECRET` and keep the encrypted JWT strategy. If using database sessions, persist the same state server-side.
- Never expose the private JWK or token fields through the browser-visible session and never log them.
- Keep public and confidential client behavior distinct. A missing secret for a confidential method must fail closed.

Do not compose `@jeswr/solid-openid-client` into this package: it owns a competing OAuth flow. Continue composing `@jeswr/solid-dpop` only for proof primitives.

Run adversarial tests and the full workspace gate for every change; this package is an authentication boundary.
