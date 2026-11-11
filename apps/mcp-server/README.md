<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/app-mcp-server

> Experimental — AI-agent-generated. Credential-bearing composition; no deployment performed.

Private Node >=24 ESM app. `src/handler.ts` exports `createApp(options)` and the lazy,
environment-configured `handler(Request): Promise<Response>`. `src/index.ts` adapts it to
`node:http`, binding to loopback. `api/index.ts` exports the same Web handler for Vercel's
Node runtime. The prepared rewrite preserves all routes; automatic deployment remains disabled.

OAuth mode composes `@jeswr/mcp-oauth`, its AES-GCM vault, and
`@jeswr/solid-mcp/http`. Every authenticated MCP POST builds a new server and scoped
storage-client PodPort (Solid or LWS) from the verified grant's pod session, including chat tools.
Opaque DCR client IDs map to stable `/clients/<id>` IRIs for memory provenance;
Client ID Metadata Document URLs retain their identity. Caller headers never reach the pod. Upstream OIDC and single-user client credentials use
`@jeswr/pod-auth/node`; storage descriptions outside the pod use guarded anonymous discovery.
LWS exact create-only operations fail closed because its names are hints.

Routes: `/mcp`, `/healthz`, `/client-id.jsonld`, `/auth/{authorize,login,callback,consent,
register,token,revoke,jwks}`, `/.well-known/oauth-authorization-server/auth`, and
`/.well-known/oauth-protected-resource/mcp`. The authorize form collects a WebID/issuer;
upstream Solid-OIDC login precedes explicit approval of the MCP client. Forms require the
browser's HttpOnly SameSite cookie, same-origin POST and CSRF secret. Callback state and
consent are consumed atomically. HTML escapes metadata, has no script or inline styles,
and carries CSP, frame denial, nosniff, no-referrer and no-store headers.
After login and approval POSTs, follow the native continuation link. This avoids
cross-origin form redirects being blocked by `form-action 'self'`.

Run locally from the repository root (Node 24):

```sh
export PATH=/opt/node24/bin:$PATH # where installed
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @jeswr/app-mcp-server... run build
export MCP_PUBLIC_ORIGIN=https://localhost:3443
export MCP_VAULT_STORE=file
export MCP_VAULT_DIRECTORY=/tmp/solid-mcp-private-vault
# Set MCP_VAULT_KEY from your secret store: canonical base64 of 32 random bytes.
PORT=3200 pnpm --filter @jeswr/app-mcp-server start
```

OAuth mode requires HTTPS even on loopback. Put a trusted local TLS proxy on `:3443`
forwarding to the Node listener on `:3200`, or use the disposable TLS integration harness
below. Use the public HTTPS origin behind a proxy that preserves Host. URL generation uses only
`MCP_PUBLIC_ORIGIN`, never forwarded headers. `MCP_ALLOWED_ORIGINS` is a comma-separated
list of exact browser origins; the default permits no cross-origin browser MCP calls.
A pod session exchanges its ID token for LWS access only with an authorization server on the
issuer's origin or a storage root's origin. `MCP_LWS_AUTHORIZATION_SERVERS` is a
comma-separated list of further HTTPS LWS authorization servers to trust; a server that a
resource names in its metadata is never trusted on that basis alone.
Writes default off; set `MCP_READ_ONLY=false` explicitly to enable them. Personal tools
retain the pod's purpose policy and special-category audit requirements. A profile must
advertise exactly one storage root; ambiguous profiles fail closed.

The default `MCP_VAULT_STORE=kv` uses the mcp-oauth Upstash/Vercel KV environment variables.
OAuth grants, replay/revocation tombstones, browser transactions, the signing key and pod
refresh credentials all share the encrypted atomic store, allowing multiple workers and
restarts. Keep `MCP_VAULT_KEY` stable. Explicit `memory` is for one process; `file` needs a
private local filesystem. Vercel rejects either local store. Operators must supply rate
limits and expiry cleanup; retain replay/revocation tombstones through grant expiry, and
never reuse retired session IDs. Abandoned browser sessions expire after ten minutes;
upstream sessions have the broker's absolute thirty-day lifetime.

The app adapts two CSS PUT differences: a verified existing-container 409 becomes a
create-only 412, and missing binary write ETags are recovered through exact byte readback
with a strong validator. Memory mutexes carry unique opaque ownership bytes, so a replaced
lock cannot be adopted during that readback. ACL failures, changed bytes and weak validators
still fail closed. Package code and its permission checks remain unchanged.

For a local CSS only, `MCP_ALLOW_LOOPBACK=true` enables the existing DNS-pinned loopback
development transport. Production leaves it unset. A remote provider must be able to
dereference the HTTPS Client ID Document.

Single-user service-account mode uses `MCP_MODE=single-user`, `SOLID_MCP_ISSUER`,
`SOLID_MCP_CLIENT_ID`, `SOLID_MCP_CLIENT_SECRET`, `SOLID_MCP_POD_ROOT` (ending `/`),
and `SOLID_MCP_WEBID`. Supply a separate random base64url `MCP_ACCESS_TOKEN` of at least
32 bytes. Configure your MCP client to send that bearer to `/mcp`; this mode does not
offer public registration or interactive OAuth. The server exchanges CSS credentials
for DPoP tokens and keeps its key/token cache only in memory. Pod tokens cannot authenticate
to MCP, and the MCP bearer is never forwarded. Supply secrets through the environment;
neither the server nor the tests print them.

Validation: `pnpm --filter @jeswr/app-mcp-server test` runs unit and local CSS integration
tests. The integration suite requires `openssl` and free ports 3390 (CSS) and 3391 (MCP).
It boots pinned CSS 8.0.0-alpha.3 once, generates a temporary TLS certificate, trusts it
only in the test worker and CSS child, and seeds unique accounts/profiles/private data.
The MCP TS SDK drives discovery, DCR, PKCE and token exchange; scripted native forms and
CSS account controls complete consent. Every exposed tool and alias is called, with
health policy denial expected. A separate owner-isolation/revocation scenario runs on the
same CSS. Setup/login failures fail the suite, and servers/certificates are removed at exit.
No external service or real account is used. `pnpm run gate` runs the affected workspace
gate. No publish or deploy is needed.

Run only the local CSS scenario with `pnpm --filter @jeswr/app-mcp-server test:e2e`.
