---
name: mcp-oauth
description: Use when implementing or integrating the MCP OAuth authorization server, its metadata, public clients, consent callback, pod broker seam, signed tokens and grant stores.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/mcp-oauth

Read this package's README, repository AGENTS.md, and MCP DESIGN §3/§5 before changing the API.
This package owns MCP-09 authorization server core and MCP-10's `createPodSessionProvider`,
`createSessionVault`, and ciphertext stores. MCP-11 supplies browser login/consent UI,
the public Solid Client ID Document, and HTTP composition.

- Use `createAuthorizationServer` and Web Request/Response; keep framework dependencies out.
- Keep upstream pod credentials inside the injected broker. Only `{id, webId}` enters grants.
- Use pod-auth/node createNodeOidcClient for upstream PKCE/state/nonce/DPoP/refresh; retain
  the original sealed private JWK with rotating refresh credentials. The protocol engine
  imports signing keys as non-extractable; only server vault envelopes contain private JWKs.
- Never let a resource choose where the ID token goes: LWS exchanges go only to the issuer's
  origin, a stored root's origin, or a configured `lwsAuthorizationServers` entry. A realm is
  a stored-root container, or a same-origin storage description whose advertised root lies
  inside a stored root and contains the resource; a description never widens the audience.
- Keep MCP_VAULT_KEY canonical base64 of exactly 32 bytes. Default to Upstash/Vercel KV;
  memory is explicit and single-process; files use a private local directory and atomic writes.
- Never weaken vault CAS or deletion tombstones. Consume callbacks once and claim refresh
  ownership before contacting the issuer. Return PodRefreshRetryableError (retryable: true) on
  contention and provably unsent failures or retryable OAuth error responses; release only via CAS
  to the original bytes. Retire other OAuth 4xx, uncertain sent outcomes, malformed refreshed claims,
  identity mismatch and final rotation persistence failure. Claims carry claimedAt and a random
  per-attempt claimId that fences release and finalization CAS (never drop it: same-second claims
  are otherwise byte-identical), and expire after 60 seconds: readSession/isActive must retire
  them, never take over a potentially spent token.
  Release and vault deletion use eight attempts with bounded backoff, including after throws.
  Never restore a spent refresh token. Crashed refreshes fail closed and require new login.
- Recheck broker `isActive` during MCP verification/issuance and before resource fetches;
  MCP revocation/reuse retires the pod session and invalidates all grants bound to it.
- Pass `verifyWebId: false` to the Node engine: the broker owns the single guarded fetch-rdf
  profile binding check at completion, alongside storage discovery and content negotiation.
  Refresh retains that binding and verifies subject/nonce/WebID without another profile fetch
  after refresh rotation.
- Resolve profiles through fetch-rdf + wrapper accessors, require profile issuer trust, scope
  authenticated fetch to advertised storage roots, refuse caller credentials and redirects.
- Keep optional positive-integer ttlSeconds on vault CAS/put/delete and record put/consume.
  Memory/file expiry must survive reads/CAS, and KV SET EX must be inside the atomic Lua script.
  Bound login/pending/browser records and their consumption markers to the original ten-minute
  deadline, unused codes to five minutes, DCR to thirty days (max ten redirect URIs). Retain used
  code evidence through grant expiry; never expire permanent session retirement tombstones.
- Treat client names as self-declared: escape all consent fields, label DCR names unverified,
  identify CIMD by its client_id URL host, and show the request's exact redirect plus prominent host.
  Use consentDisplay(context) for the escaped, bidi-isolated HTML fragment; reject control/format
  characters in client_name and render URL hosts in punycode.
- Require PKCE S256, nonempty state, exact redirects, and an exact configured resource.
- Keep ES256 access tokens ten minutes and bind `aud` to the MCP resource.
- Consume codes/refresh credentials atomically. Reuse revokes the entire family; never reset
  a revoked grant. Hash bearer credentials before storing them and retain reuse tombstones.
- Use the DNS-pinning guarded-fetch Node entry for client metadata. Never follow redirects;
  preserve response size/time limits and exact client_id matching. metadataFetch is a trusted
  test/composition seam and must already enforce SSRF protection.
- `authorize(request, session)` is trusted completion, never an unauthenticated HTTP route.
  The composition authenticates the browser and validates consent/CSRF before calling it.
- Await `grantCreated({grant, client, redirectUri, issuedAt})` after durable grant storage and
  before code storage. It receives independent readonly-typed snapshots and seconds since epoch;
  denial skips it. Hook failure must prevent a code, attempt session-wide revocation and return
  a trusted `server_error` redirect with state/iss, including if credential cleanup fails.
- `revokeGrant(grantId)` is a trusted server-only API: unknown IDs are no-ops, retries remain
  irreversible and retry cleanup, and every grant on that pod session must fail verification
  and code/refresh exchange. Propagate storage/broker failures to the caller.
- Pluggable stores require durable atomic consume and irreversible revoke; memory stores are
  single-process fixtures. `./testing` exposes these stores to dependent tests.
- Use fixtures only. Exercise signature verification, replay races, audience/expiry failures,
  malformed metadata and denial paths. Keep all coverage thresholds at 100%.

Validate with package lint/build/typecheck/test, root lint and affected/full Turbo gates.
Do not add dependencies or publish without task authorization and the package-policy check.
