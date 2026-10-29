<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/mcp-oauth

> Experimental — AI-agent-generated. Security-critical; private pending conformance review.

Node >=24 authorization server core for MCP. Supports RFC 8414 authorization-server metadata,
RFC 9728 resource metadata, RFC 7591 public-client registration, Client ID Metadata Documents,
PKCE S256, exact redirects, RFC 8707 resource binding, ten-minute ES256 access tokens, JWKS,
rotating refresh tokens with family reuse detection, and RFC 7009 revocation.

```ts
import { createAuthorizationServer } from "@jeswr/mcp-oauth";

const oauth = createAuthorizationServer({
  issuer: "https://mcp.example/auth",
  resource: "https://mcp.example/mcp",
  podSessions, // injected MCP-10 PodSessionProvider
  consent: async ({ client, authorization, session, request }) => {
    return consentService.isApproved({ client, authorization, session, request });
  },
  scopes: ["mcp"],
  stores,     // optional; defaults to single-process memory stores
  signingKey, // optional; persist an ES256 private KeyObject + kid in production
});

const response = await oauth.handle(request);
const principal = await oauth.verifyAccessToken(accessToken, "https://mcp.example/mcp");
// principal.sessionId stays on the server: podSessions.fetchFor(principal.sessionId)
```

All endpoints are under the issuer: `/register` (JSON POST), `/authorize` (GET), `/callback`
(upstream GET), `/token` and `/revoke` (form POST), `/jwks` (GET). Metadata follows the RFC
well-known insertion rule: `/.well-known/oauth-authorization-server/auth` and
`/.well-known/oauth-protected-resource/mcp` for the example above;
`oauth.protectedResourceMetadataUrl()` returns the latter for a resource server's
`WWW-Authenticate` challenge (pass it to `@jeswr/solid-mcp/http` as `resourceMetadataUrl`). Metadata, JWKS, errors,
token responses and redirects carry `Cache-Control: no-store`.
`metadataUrl(identifier, suffix)` from `@jeswr/mcp-oauth/metadata` shares this construction
with the MCP HTTP transport without loading the authorization server.

Registration accepts HTTPS or HTTP loopback (`localhost`, 127/8, `::1`) redirect URIs, without
userinfo or fragments. Redirect comparison is exact, including loopback ports and URI spelling.
Only public clients are supported; specify `token_endpoint_auth_method: "none"`. Accepted grants
are authorization_code and refresh_token (both returned by default). An explicit authorization_code
only registration receives no refresh token. Unsupported authentication methods are rejected.
No client secret is generated. Unrecognized registration metadata is ignored.

Authorization requires `response_type=code`, `client_id`, registered `redirect_uri`, nonempty
`state`, `code_challenge`, `code_challenge_method=S256`, and one exact configured `resource`.
Both code and refresh token requests require `client_id` and `resource`. Code exchange additionally
requires `code`, exact `redirect_uri`, and `code_verifier`; refresh exchange requires `refresh_token`.
Optional scope must be within configured scopes; refresh cannot change it. Duplicate parameters
are rejected. Revocation takes `token` and `client_id`; token_type_hint is advisory and ignored.

`/authorize` additionally accepts `webid` (a WebID or issuer) and delegates login to
`podSessions.begin(value, callbackUrl)`. The broker supplies cryptographic state and validates
upstream OIDC on `complete(callbackUrl, state)`. A ten-minute single-use server transaction binds
the MCP request to this state. The callback passes `{ id, webId }` to the consent callback and
issues a five-minute authorization code only on approval. It never serializes upstream tokens.
For MCP-11's interactive UI, the composition may first authenticate the browser and record its
CSRF-protected consent decision, then call the trusted `authorize(request, session)` completion
API. This API is server-only: never accept a session identity supplied by an HTTP client.
The consent callback receives independent snapshots, so mutation cannot change the issued grant.

Refresh families expire absolutely thirty days after consent. Each successful refresh replaces
the presented refresh token. Replaying a code or refresh token revokes its entire family.
`/revoke` also revokes the family for either kind of token and returns 200 for unknown tokens.
`verifyAccessToken` checks ES256, kid, issuer, audience, time, claims and current family status;
use it for immediate family revocation. JWT-only external verifiers cannot observe family
revocation before access-token expiry. MCP-10 owns upstream session revocation and its cascade.

Default client-document fetches use `@jeswr/guarded-fetch/node` (DNS pinning, SSRF checks,
64 KiB cap, eight-second timeout, no redirects). Documents must be JSON, HTTP 200, with a
`client_id` exactly matching the requested HTTPS URL. Invalid documents are never cached.
The bounded 256-entry cache respects no-store/no-cache, max-age and Age, capped at five minutes.
The optional metadataFetch seam is trusted and must provide equivalent SSRF/DNS protection;
the core still enforces media type, response status and streaming size limits. Metadata strings
are untrusted UI input; the composition must escape them when rendering consent.

`OAuthStores` is the persistence seam. Reads return snapshots; writes complete durably before
resolving. `consume` must atomically mark a record used and retain it for replay detection;
grant revocation must be irreversible. Reject overwrites/collisions. Keep replay tombstones
through family expiry and never reuse IDs. Memory stores have no cleanup and are intended
for tests/single-process bounded deployments; production composition supplies durable stores,
expiry cleanup and request rate limits. Multiple workers must share stores and the signing key.
The `./testing` export supplies isolated `createMemoryStores`, `MemoryStore` and `MemoryGrantStore`.

Run `pnpm --filter @jeswr/mcp-oauth run lint`, `build`, `typecheck`, and `test`.
Tests use only injected broker/fetch fixtures and enforce 100% branch coverage.

Protocol references: [AS metadata](https://www.rfc-editor.org/rfc/rfc8414.html),
[resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html),
[DCR](https://www.rfc-editor.org/rfc/rfc7591.html),
[resource binding](https://www.rfc-editor.org/rfc/rfc8707.html),
[revocation](https://www.rfc-editor.org/rfc/rfc7009.html),
[Client ID Metadata Documents draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02).
