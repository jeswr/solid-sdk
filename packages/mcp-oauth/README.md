<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

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
  podSessions, // createPodSessionProvider(), configured below
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
`/.well-known/oauth-protected-resource/mcp` for the example above. Metadata, JWKS, errors,
token responses and redirects carry `Cache-Control: no-store`.

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
revocation before access-token expiry. MCP revocation and code/refresh reuse retire the bound
pod session as well. The built-in broker's durable `isActive` check rejects every grant bound
to a retired or expired session during access verification and token issuance. Direct broker
revocation has the same effect; affected grant records are marked revoked when next checked.
The grant store persists session-wide revocation intent before broker credential cleanup. All
bound grants remain denied if cleanup fails, across workers and restarts sharing the stores.
Subsequent checks retry cleanup even for an already-revoked grant. Legacy injected providers may
omit `isActive`; session-wide MCP revocation still applies through the grant store.

```ts
import { createPodSessionProvider, createSessionVault } from "@jeswr/mcp-oauth";

const vault = createSessionVault();
const podSessions = createPodSessionProvider({
  clientId: "https://mcp.example/client-id.jsonld",
  redirectUri: "https://mcp.example/auth/callback",
  vault,
});
```

Set `MCP_VAULT_KEY` to a persistent, securely generated 32-byte key in canonical padded base64.
The default encrypted store uses Upstash Redis REST through `KV_REST_API_URL` and
`KV_REST_API_TOKEN`, falling back to `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
No KV SDK is required. For a local filesystem, pass `store: new FileVaultStore(directory)`;
for isolated tests, pass `store: new MemoryVaultStore()`. Both are exported from this package.
All stores receive only AES-256-GCM ciphertext (fresh 96-bit IV; version and record ID bound as
authenticated data). The file store uses hashed filenames, 0600 files, 0700 new directories,
fsynced writes and atomic rename. Use a dedicated private directory on a local filesystem.
The key and store must be shared across restarts/workers. Losing the key requires new logins.

The broker uses the server's public Solid Client ID Document, served by MCP-11. It must declare
the exact callback URI, `token_endpoint_auth_method: "none"`, and
`scope: "openid webid offline_access"`. The broker requests consent, PKCE S256, state, nonce and
a new ES256 DPoP key for each login. It resolves an issuer directly, or falls back to the input
WebID's profile only when discovery returns HTTP 404. Ambiguous/missing profile issuers fail;
malformed discovery, transport failures and issuer mismatches never trigger fallback. After
OIDC completion, the verified WebID must match a supplied WebID and advertise the selected issuer
in its own profile. Remote JSON-LD contexts are refused by the RDF parser.

`complete()` consumes pending login state atomically and returns only `{ id, webId }`. The
refresh token and private DPoP JWK stay in the vault; access/ID tokens stay in process memory.
`fetchFor(id)` returns a fetch that checks durable session liveness on every call, permits only
the WebID profile's `pim:storage` roots, refuses caller Authorization/DPoP/Cookie headers, omits
browser credentials, and refuses redirects. It restores with the original DPoP key and refreshes
on access expiry, persisting token rotation before sending a resource request. The existing
Solid client handles bounded nonce retries at both the token and resource endpoints.
Private clients are capped at 256 cached entries and evicted after at most five minutes or
at access/session expiry, whichever comes first. Failed liveness checks remove cached credentials.
Default network transport pins DNS, refuses SSRF targets, caps responses at 1 MiB and sets an
eight-second deadline. An injected `fetch` must supply equivalent network protections.

Vault CAS operations atomically consume callbacks and claim refresh ownership across workers.
Contention fails closed instead of redeeming a rotating refresh token twice. A process crash
during a claimed refresh requires a new login. File lock files left by a crashed writer require
operator cleanup while the store is offline. Deleted IDs retain irreversible tombstones: never
reuse them or remove tombstones while an old request could still complete. Local `revoke()`
destroys credentials and retires the session; it does not require a remote revocation endpoint.
Retirement retries CAS contention until a deletion tombstone is durable.
Sessions expire absolutely after thirty days; login state expires after ten minutes. Expired
record/tombstone cleanup and request rate limits belong to the deployment.

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
`GrantStore.revokeSession` must durably and idempotently retain irreversible session tombstones;
`isSessionRevoked` must observe them across workers. Keep these tombstones while any bound grant
can be used, and never reuse retired session IDs. The `./testing` export supplies isolated
`createMemoryStores`, `MemoryStore` and `MemoryGrantStore`.

Run `pnpm --filter @jeswr/mcp-oauth run lint`, `build`, `typecheck`, and `test`.
Tests use only injected broker/fetch fixtures and enforce 100% branch coverage.

Protocol references: [AS metadata](https://www.rfc-editor.org/rfc/rfc8414.html),
[resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html),
[DCR](https://www.rfc-editor.org/rfc/rfc7591.html),
[resource binding](https://www.rfc-editor.org/rfc/rfc8707.html),
[revocation](https://www.rfc-editor.org/rfc/rfc7009.html),
[Client ID Metadata Documents draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02).
