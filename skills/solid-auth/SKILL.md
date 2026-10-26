---
name: solid-auth
description: Use when building or hardening Solid server token verification, DPoP proofs, WebID resolution, replay protection, SSRF guards with DNS pinning, or Keycloak realm preflight. Covers issuer-agnostic oauth4webapi verification and bidirectional WebID/issuer checks; client login is covered by solid-reactive-authentication and solid-auth-core.
---

## Quick reference

Verify tokens and DPoP proofs with `oauth4webapi`; allowlist issuers before discovery and asymmetric algorithms only.
Fail closed on replay-store outages, untrusted WebID/issuer assertions, unsafe DNS answers, or invalid claims.
Pin validated DNS addresses, bound profile fetches, and refuse remote JSON-LD contexts.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Implementation paths, ADR numbers, server-specific defaults, and commands below refer to
the original `prod-solid-server` implementation, outside this SDK checkout. They document
that server's patterns, rather than files or dependencies to install in this workspace.

# Solid auth (Solid-OIDC / DPoP / WebID verification)

Security-critical patterns for verifying Solid-OIDC access tokens on a resource server. Grounded in
`src/auth/{verifier,webidResolver,replayStore,replay,realmPreflight,types}.ts` and ADR-0004. The core
is **`oauth4webapi`** (panva) + **`undici`** (DNS-pinned fetch) + **`ioredis`/`lru-cache`** (replay +
profile caches). Use **Context7** for exact `oauth4webapi` APIs. 🔒 = security-critical; get these right.

## When to use

Verifying Solid-OIDC / DPoP-bound access tokens; resolving/validating WebID profiles; implementing
replay protection; defending against issuer compromise or SSRF; wiring trusted issuers / Keycloak.

<!-- AUTHORED-BY Codex GPT-6 -->

## 🔒 Verify with oauth4webapi — never hand-roll

`oauth4webapi.validateJwtAccessToken(as, request, audience, opts)` does the RFC 6750/9068/9449 core:
JWS signature against the issuer's JWKS, `typ=at+jwt`, required claims, **DPoP proof binding**
(`typ=dpop+jwt`, `htm`/`htu`/`ath`/`cnf.jkt`), and `iat` freshness. **Never hand-roll signature or
proof validation.** Pre-check the **trusted-issuer allowlist against the *unverified* `iss`** *before*
discovery — otherwise an attacker-controlled `iss` makes you fetch an SSRF discovery URL.

```ts
if (!trustedIssuers.has(unverifiedIss)) throw challenge("invalid_token", "Untrusted issuer.");
const claims = await oauth.validateJwtAccessToken(as, request, audience, {
  requireDPoP: dpop, signingAlgorithms: SIGNING_ALGS, [oauth.clockTolerance]: 5,
});
```

The result is the claims object itself ([return contract](https://github.com/panva/oauth4webapi/blob/main/docs/functions/validateJwtAccessToken.md));
`clockTolerance` is a symbol-keyed option ([options](https://github.com/panva/oauth4webapi/blob/main/docs/interfaces/ValidateJWTAccessTokenOptions.md)).

## 🔒 Asymmetric algorithms only

Allowlist `ES256/384/512`, `PS256/384/512`, `RS256/384/512`. **Reject `HS*` (symmetric → token
forgery) and `none` (no validation).** Pass the list as `signingAlgorithms`, and advertise it in the
`WWW-Authenticate` challenge (`algs="…"`, RFC 9449 §5.1).

## 🔒 DPoP `jti` replay cache — fail-closed, checked early

Use the cryptographically verified **DPoP proof's** `jti` and `iat` (not the access token's claims
or an unverified JWT decode). Reject `iat` more than `clockTolerance` in the future. Retain each
`jti` until `iat + maxAge + clockTolerance`, the last instant that proof can be accepted. Compute
the remaining TTL from that deadline; a fixed `maxAge + clockTolerance` from first receipt can
expire too early for a future-dated proof within tolerance. Use atomic `SET key 1 NX EX ttl`
(Redis) or an in-process LRU that retains entries through the same deadline.
**Check replay BEFORE the expensive bidirectional WebID fetch.** Production
**fail-closed**: Redis down → `503` + `WWW-Authenticate`. Dev escape valve (`PSS_REDIS_FAIL_OPEN_DEV=true`,
refused in `NODE_ENV=production`) falls back to in-process with a rate-limited warn.

```ts
// jti and iat come from the verified DPoP proof; keep these limits aligned with verification.
const maxAge = 300; // seconds
const clockTolerance = 5; // seconds
const now = Date.now() / 1000;
const acceptUntil = iat + maxAge + clockTolerance;
if (iat > now + clockTolerance || now > acceptUntil) {
  throw challenge("invalid_token", "DPoP proof outside acceptance window.");
}
// Use whole Redis EX seconds strictly past the inclusive acceptance boundary.
const ttl = Math.floor(acceptUntil - now) + 1;
if (await replay.mark(jti, ttl) === "replay") throw challenge("invalid_token", "DPoP proof replayed.");
```

## 🔒 Bidirectional WebID↔issuer check (defence vs issuer compromise)

After the token passes, dereference the WebID profile and require `<webid> solid:oidcIssuer <claims.iss>`.
A compromised/rogue issuer can mint a token for *any* `webid` claim; this triple is the profile owner's
counter-assertion of which issuer they trust. Mode-aware: `strict` (default) → 401 on mismatch; `warn` →
log+accept; `off` → skip. **Auto-downgrades to `warn` only when the mode is unset AND all trusted issuers
are loopback HTTP** (dev/CI). Surface a **constant** client error; log the real reason internally.

## 🔒 SSRF guard + DNS pinning on profile fetch

WebID profiles are attacker-influenced URLs. Resolve the host once, classify **every** A/AAAA record,
and **refuse if any** is non-public: loopback, RFC-1918, CGNAT `100.64/10`, link-local, IPv4-mapped
`::ffff:*`, IPv6 ULA `fc00::/7`, multicast, plus `6to4 2002::/16` and NAT64 `64:ff9b::/96` with their
**embedded-IPv4** re-checked. **Pin the first validated IP into the fetch** so guard and socket see the
same address (closes DNS-rebinding TOCTOU), and **re-run the guard on every redirect `Location`**.

```ts
const pinned = await assertNotSsrf(url);                 // throws on any non-public record
const res = await fetcher(url, {
  dispatcher: new Agent({ connect: { lookup: (_h,_o,cb) => cb(null, [pinned]) } }),
  redirect: "manual",                                    // re-guard each hop
});
```

## 🔒 Bound the fetch; no remote JSON-LD context

One `AbortController` spans the whole resolution (fetch + redirects + body read); reject
`Content-Length > maxBytes` (256 KiB) up front and abort on stream overflow. Parse profile JSON-LD with a
**bundled-context-only loader** (solid terms/oidc-context, foaf, pim/space) — any remote `@context` →
reject (same rule as [solid-rdf](../solid-rdf/SKILL.md)'s SSRF-safe loader).

## 🔒 Claim hardening

- **WebID claim**: present, non-empty, valid URL, **`https:` only**, **no userinfo** (`user:pass@`) — a
  non-https or userinfo WebID leaks credentials on fetch.
- **Audience** (RFC 9068 §3): require `aud` includes this RS's URL.
- **Authorized party**: when configured, require `azp` (or `client_id`) ∈ allowlist — blocks a token the
  issuer minted for a *different* client/RS (audience confusion).

## 🔒 Realm preflight gate (boot-time, fail-closed)

At boot, for every trusted **Keycloak** realm, fetch `…/admin/realms/{realm}/users/profile` and assert the
`webid` attribute is **admin-edit-only** (`permissions.edit: ["admin"]`). If a user can edit their own
`webid`, any account mints tokens for any WebID — the identity model collapses. Refuse to boot otherwise.
Non-Keycloak issuers fail-closed unless explicitly allow-listed (typo guard). (Boot-only; add a periodic
re-check for live drift.)

## Performance: two-tier WebID cache (not security, but in the brief)

L1 in-process LRU (sync, no Redis hop on hits) → L2 Redis → on full miss, a per-WebID `SET NX EX 8s`
lock: the winner fetches + populates + signals; losers wait (bounded ~6s) then re-read L2, else fetch
themselves — bounding amplification to at-worst-once-per-replica. Negative cache (~30s) memoises failures.
See [solid-rdf](../solid-rdf/SKILL.md) for the RDF parsing and the bundled-context loader these reuse.

## Gotchas

- [ ] Trusted-issuer allowlist checked against the **unverified** `iss` *before* discovery (SSRF).
- [ ] Asymmetric algs only; never `HS*`/`none`.
- [ ] Reject future `iat` beyond tolerance; retain `jti` through `iat + maxAge + clockTolerance`; check replay **before** the bidirectional fetch.
- [ ] SSRF guard refuses if **any** DNS record is non-public; fetch **pinned**; redirects re-guarded.
- [ ] One AbortController for the whole resolution; byte cap enforced; remote `@context` refused.
- [ ] WebID is `https:` with no userinfo; `aud` + `azp` enforced.
- [ ] Realm preflight is fail-closed at boot; non-Keycloak issuers opt-in only.
- [ ] Client-facing auth errors are **constant** (no reconnaissance oracle); real reason logged internally.
- [ ] Prod fail-closed on replay-store outage (503); `FAIL_OPEN_DEV` refused in production.

## See also

- Code: `src/auth/{verifier,webidResolver,replayStore,realmPreflight}.ts`; ADR-0004 (trust model),
  ADR-0012 §4.1/§4.3 (shared replay + WebID L2). Related skills: [solid-rdf](../solid-rdf/SKILL.md), [solid-wac](../solid-wac/SKILL.md),
  [solid-conformance](../solid-conformance/SKILL.md).
- Specs / libs (Context7): `oauth4webapi`, `undici`, RFC 6750 / 9068 / 9449, Solid-OIDC (W3C),
  RFC 1918 / 6598 / 3056 / 6052 (IP ranges), Keycloak declarative user profile.
