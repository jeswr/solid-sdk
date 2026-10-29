---
name: mcp-oauth
description: Use when implementing or integrating the MCP OAuth authorization server, its metadata, public clients, consent callback, pod broker seam, signed tokens and grant stores.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/mcp-oauth

Read this package's README, repository AGENTS.md, and MCP DESIGN §3/§5 before changing the API.
This package owns MCP-09 authorization server core. MCP-10 supplies PodSessionProvider and
the upstream credential vault; MCP-11 supplies browser login/consent UI and HTTP composition.

- Use `createAuthorizationServer` and Web Request/Response; keep framework dependencies out.
- Keep upstream pod credentials inside the injected broker. Only `{id, webId}` enters grants.
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
