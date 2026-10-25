<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP-09 conservative readings

1. **MCP-01 scaffold missing from the named base** (MCP DESIGN §2, tasks MCP-01/MCP-09).
   Options: import another branch, or create only the package needed by this lane.
   Applied: create `packages/mcp-oauth` and its suite entry. No fetch/merge or changes to the
   other MCP-01 surfaces; the lane brief does not prescribe a local dependency merge.
2. **Unspecified lifetimes and client authentication** (MCP DESIGN §5).
   Options: indefinite grants/configurable policy, or bounded public-client-only support.
   Applied: five-minute codes, ten-minute login transactions and access tokens, absolute
   thirty-day refresh families; public clients (`token_endpoint_auth_method: none`) only.
   Require one exact configured resource at authorization and token endpoints, and state.
3. **Consent and login UI seam** (MCP DESIGN §3/§5; tasks MCP-09/MCP-11).
   Options: implement UI here, or expose trusted authorization completion plus a callback.
   Applied: an injected async boolean consent callback; `/authorize?webid=<WebID-or-issuer>`
   begins broker login and `/callback` completes it. MCP-11 may render its UI first and call
   the core's trusted `authorize(request, session)` API after authenticating the browser and
   validating its consent/CSRF state. This lane adds no consent UI or upstream OIDC broker.
4. **Revocation scope** (MCP DESIGN §5; tasks MCP-09/MCP-10).
   Options: revoke individual tokens, or the entire MCP grant/family.
   Applied: any known access/refresh token revokes the family; code replay and refresh reuse
   also revoke the family, including access tokens checked through this server. Broker-wide
   session revocation belongs to MCP-10, because a pod session can serve multiple grants.
5. **Metadata cache limits** (MCP DESIGN §2/§5; task MCP-09).
   Options: arbitrary size/TTL, or small bounded metadata documents.
   Applied: 64 KiB documents/HTTP bodies, eight-second metadata fetch timeout, no redirects,
   five-minute maximum cache TTL (respect no-store/no-cache and shorter max-age), 256-entry
   in-memory metadata cache. The default fetch is the DNS-pinning guarded-fetch Node entry.
