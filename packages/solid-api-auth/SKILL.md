---
name: solid-api-auth
description: Use when maintaining or consuming server-side Solid access-token verification, shared OIDC discovery and JWKS rotation, DPoP replay binding, and WebID issuer endorsement in solid-api-auth.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Read [README.md](README.md) for the two verifier profiles and public options. Server-only.

Use `DpopApiVerifier` for trusted-issuer API authentication and optional owner authorization.
It requires `at+jwt`, `exp`, `iat`, `sub`, `cnf` and the WebID claim, without pinning audience.
Keep the issuer allowlist check before discovery. Its default resolver uses the same guarded
transport as its `webidFetch` seam. An injected `resolveIssuer` controls key selection;
injected results still have bounded, coalesced ten-minute caching and load deadlines.

Use `createResourceTokenVerifier` for Solid-audience resource requests. It returns
`{ webid, clientId, issuer, expiresAt }`; callers enforce route/client/sender policy.
Require an SSRF-guarded `outboundFetch`, a configured public origin and an atomic shared
`ResourceReplayStore.insertIfAbsent(key, ttlMs)`. Store failure and replay reject. Keep
its ±60-second proof window, 300,000 ms replay TTL, exact WebID-subject issuer endorsement,
and public-origin/pathname binding. Forwarded headers never choose that origin.
The API verifier additionally accepts profile-document-subject issuer endorsements.
Both use `webid-issuers.ts`; preserve that intentional policy difference.

`createIssuerKeyResolver` is the exported `ResolveIssuer` seam for other resource servers.
It selects keys; it does not establish issuer trust or validate token claims by itself.
Pass the returned `jwks` to `jose` with the caller's issuer/audience/algorithm requirements.
Do not reimplement discovery, JWKS coordination or refresh policy in consuming apps.

Preserve these coordination invariants:

- Discovery and JWKS caches and their in-flight maps are separately bounded (default 1,000).
  Successful values expire after ten minutes. Loads span body reads, abort after five seconds
  and release their slot even if the transport ignores abort. Late settlement cannot cache.
- Force refresh only for `ERR_JWKS_NO_MATCHING_KEY`. Retry the newest cached snapshot first,
  join an existing URL load, then enforce the one-minute per-URL cooldown. Ordinary reads
  can use valid cached values while a refresh runs. Every waiter verifies its own token.
- Failed refreshes consume cooldown but preserve the last working value and its original TTL.
  Expire cooldown entries before evicting the oldest; preserve evicted live deadlines through
  the conservative overflow deadline. Never let URL churn reset an active cooldown.
- Callers supply DNS/redirect/byte guards; the helper adds anonymous credentials and load
  deadlines. Never pass inbound credentials to discovery, JWKS or profile fetches.

Keep regressions in `test/issuer-keys.test.ts`, `test/discovery-cache.test.ts`,
`test/refresh-cooldowns.test.ts`, `test/jwks-settlement.test.ts` and the resource-token suite.
Use real signatures, injected fetch/clock/store and controlled promise settlement. Cover new
branches, including timeout, capacity and failure recovery. Build workspace dependencies before
its gate, and refresh `etc/` API reports when changing exports. Never edit `dist/`.
