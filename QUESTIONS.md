<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.15 conservative readings

1. **Pristine HTTP** (Task, last bullet): require an explicit `options.fetch`, or
   fall back to a global fetch captured by the package? Choose required pristine
   fetch: the existing provider reads the global at construction, which cannot
   guarantee an unpatched fetch. Callers capture it before installing any patch.
2. **Client authentication** (Task, RFC 6749 §6): public clients only, or match
   the provider's public/Basic behavior? Match the provider: require `clientId`,
   accept optional `clientSecret` for Basic authentication, and reject an
   explicitly empty/invalid secret. No new client-auth methods are introduced.
3. **Nonce challenges** (Task, retry bullet): retry any error with a nonce header,
   or require `error: "use_dpop_nonce"` plus the nonce? Require both, with a 4xx
   response. Narrow the shared token seam accordingly so an `invalid_grant` with
   a nonce header never replays a refresh credential.
4. **Expiry** (Task, response-validation bullet): accept arbitrary numeric values,
   or RFC 6749 seconds? Require a finite, nonnegative safe integer and a safely
   representable expiry in epoch seconds, matching `SolidJwtState.expiresAt`.
   Zero is valid and expires immediately. Count from the token request's start.
