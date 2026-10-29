---
name: mcp-oauth
description: Implement or integrate the MCP OAuth authorization server, its metadata, public clients, consent callback, pod broker seam, signed tokens and grant stores.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/mcp-oauth

Read this package's README, repository AGENTS.md, and MCP DESIGN §3/§5 before changing the API.
This package owns MCP-09 authorization server core and MCP-10's `createPodSessionProvider`,
`createSessionVault`, and ciphertext stores. MCP-11 supplies browser login/consent UI,
the public Solid Client ID Document, and HTTP composition.

- Use `createAuthorizationServer` and Web Request/Response; keep framework dependencies out.
- Keep upstream pod credentials inside the injected broker. Only `{id, webId}` enters grants.
- Use solid-openid-client + solid-dpop for upstream PKCE/state/nonce/DPoP/refresh; retain the
  original private key with rotating refresh credentials. MCP-15 owns migration to pod-auth.
- Keep MCP_VAULT_KEY canonical base64 of exactly 32 bytes. Default to Upstash/Vercel KV;
  memory is explicit and single-process; files use a private local directory and atomic writes.
- Never weaken vault CAS or deletion tombstones. Consume callbacks once and claim refresh
  ownership before contacting the issuer. Crashed refreshes fail closed and require new login.
- Recheck broker `isActive` during MCP verification/issuance and before resource fetches;
  MCP revocation/reuse retires the pod session and invalidates all grants bound to it.
- Resolve profiles through fetch-rdf + wrapper accessors, require profile issuer trust, scope
  authenticated fetch to advertised storage roots, refuse caller credentials and redirects.
- Require PKCE S256, nonempty state, exact redirects, and an exact configured resource.
- Keep ES256 access tokens ten minutes and bind `aud` to the MCP resource.
- Consume codes/refresh credentials atomically. Reuse revokes the entire family; never reset
  a revoked grant. Hash bearer credentials before storing them and retain reuse tombstones.
- Use the DNS-pinning guarded-fetch Node entry for client metadata. Never follow redirects;
  preserve response size/time limits and exact client_id matching. metadataFetch is a trusted
  test/composition seam and must already enforce SSRF protection.
- `authorize(request, session)` is trusted completion, never an unauthenticated HTTP route.
  The composition authenticates the browser and validates consent/CSRF before calling it.
- Pluggable stores require durable atomic consume and irreversible revoke; memory stores are
  single-process fixtures. `./testing` exposes these stores to dependent tests.
- Use fixtures only. Exercise signature verification, replay races, audience/expiry failures,
  malformed metadata and denial paths. Keep all coverage thresholds at 100%.

Validate with package lint/build/typecheck/test, root lint and affected/full Turbo gates.
Do not add dependencies or publish without task authorization and the package-policy check.
