<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/solid-mcp

An MCP server that exposes a Solid pod as scoped resources and read, search, list, and write tools.

Library callers supply authentication; the stdio CLI supports CSS client credentials.
Access is confined to one pod root, and writes are disabled by default.

> Experimental — AI-agent-generated. Review the scope and keep `readOnly: true` unless the MCP client should modify pod
> data.

## Install

```sh
npm install github:jeswr/solid-mcp#main "@modelcontextprotocol/sdk@^1.29"
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import { createSolidMcpServer } from "@jeswr/solid-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = createSolidMcpServer({
  fetch: authenticatedFetch,
  podRoot: "https://alice.example/",
  webId: "https://alice.example/profile/card#me",
  readOnly: true,
});

await server.connect(new StdioServerTransport());
```

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Authenticated stdio CLI

The bundled `solid-mcp` CLI logs in with a Community Solid Server (CSS) account's
client-credentials token **id and secret**, exchanged for a DPoP-bound access token.
These are CSS account credentials, not a public OIDC Client Identifier Document.
Tokens and the DPoP key stay in process memory; expired tokens are re-acquired using
the same key. Nothing is cached on disk. All registered tools and resources use the
same authenticated fetch; writes still require `readOnly: false`.

Set environment variables or create `~/.config/solid-mcp/config.json`:

```json
{
  "podRoot": "https://alice.example/",
  "webId": "https://alice.example/profile/card#me",
  "readOnly": true,
  "oidcIssuer": "https://solid.example/",
  "clientId": "YOUR_CSS_CREDENTIAL_ID",
  "clientSecret": "YOUR_CSS_CREDENTIAL_SECRET"
}
```

Create the file privately before editing it, and keep it out of version control:

```sh
mkdir -p ~/.config/solid-mcp
install -m 600 /dev/null ~/.config/solid-mcp/config.json
# Edit the file with your own values, then verify its mode:
chmod 600 ~/.config/solid-mcp/config.json
```

An existing config must be a regular file with **exactly mode 0600**; symlinks and
other modes are refused, including when environment variables override its values.
Environment variables override individual JSON fields:

| Environment | JSON field | Meaning |
| --- | --- | --- |
| `SOLID_MCP_POD_ROOT` | `podRoot` | Required absolute pod/container URL ending in `/` |
| `SOLID_MCP_WEBID` | `webId` | Optional owner WebID for Type Index discovery |
| `SOLID_MCP_READONLY` | `readOnly` | Defaults to `true`; explicit `false` enables writes |
| `SOLID_MCP_CLIENT_ID` | `clientId` | CSS client-credentials token id |
| `SOLID_MCP_CLIENT_SECRET` | `clientSecret` | CSS client-credentials token secret |
| `SOLID_MCP_OIDC_ISSUER` | `oidcIssuer` | Issuer used for OIDC discovery |
| `SOLID_MCP_TOKEN_URL` | `tokenUrl` | Explicit token endpoint; overrides discovery |

Provide both credentials and either the issuer or token endpoint. Partial auth
settings or failed login stop startup; there is no anonymous fallback after an auth
failure. With no auth settings, public-pod access remains available. Authenticated
pod/auth endpoints require HTTPS, with HTTP allowed for loopback development.
Credentials are only attached within the configured pod scope; off-pod profile
discovery is anonymous. Diagnostics go to stderr; stdout carries MCP messages only.

### Claude Desktop

Build the CLI and its workspace dependencies from the suite root:

```sh
pnpm --filter '@jeswr/solid-mcp...' run build
```

With the private config above, add this to `claude_desktop_config.json` (on macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`). Replace both
paths with absolute paths for your installation, then restart Claude Desktop.
See the [official local-server setup](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

```json
{
  "mcpServers": {
    "solid-pod": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
    }
  }
}
```

### Claude Code

Use the same private config and build output. In the project's `.mcp.json`, following
the [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp):

```json
{
  "mcpServers": {
    "solid-pod": {
      "type": "stdio",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
    }
  }
}
```

### Codex

With the same private config and build output, add to `~/.codex/config.toml`, following
the [official Codex MCP configuration](https://developers.openai.com/codex/mcp/):

```toml
[mcp_servers.solid-pod]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
```

For environment-only setup, Codex can forward credentials from its launching shell:

```toml
[mcp_servers.solid-pod]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/solid-sdk/packages/solid-mcp/dist/cli.js"]
env_vars = ["SOLID_MCP_POD_ROOT", "SOLID_MCP_WEBID", "SOLID_MCP_READONLY", "SOLID_MCP_CLIENT_ID", "SOLID_MCP_CLIENT_SECRET", "SOLID_MCP_OIDC_ISSUER", "SOLID_MCP_TOKEN_URL"]
```

## Key API

- Server: `createSolidMcpServer`, `SolidMcpConfig`.
- Operations: `listContainer`, `readResource`, `readRdf`, `search`, `writeResource`.
- Scope: `normalizePodRoot`, `requirePodScopedUrl`, `podScopedUrlOrUndefined`.
- Data seam: `PodPort`, `createFetchPodPort`, `PodConditions`.
- Registry: `createPodToolRegistry`, `registerPodTools`, `PodTool` (Zod schema, handler, readOnly flag).
- MCP tools: `pod_list`, `pod_read`, `search`, and opt-in `pod_write`.
- One-release aliases in v0.2: `solid_list`, `solid_read`, `solid_search`, `solid_write`.
  Aliases retain the same schemas, output and read-only enforcement.

## Portable pod access

```ts
import { createFetchPodPort, createSolidMcpServer } from "@jeswr/solid-mcp";

const pod = createFetchPodPort({
  fetch: authenticatedFetch,
  podRoot: "https://alice.example/",
  webId: "https://alice.example/profile/card#me",
  readOnly: true,
});
const server = createSolidMcpServer({ pod });
```

`PodPort` exposes raw-byte `read`, `list`, conditional `write` and `delete`, `root` and
`webId`. Optional `PodReadOptions.accept` selects a representation; generic reads keep
the backend default, while RDF/profile reads request RDF explicitly. The fetch adapter retains listing metadata, ETags, guarded read redirects,
and refusal of all mutation redirects. Mutations reject the root and its slashless
alias. Both adapter and server default to read-only; opt into writes at both layers.
The configured WebID remains readable for Type Index discovery even when off-pod;
off-pod profile redirects are refused for ordinary injected fetch functions. The CLI's
anonymous transport permits bounded, validated same-origin profile redirects.
Client tools and resources are always confined to the pod root. A custom PodPort
must enforce its data boundary and mutation policy too.

The existing fetch-based server configuration and exported pod operations remain
supported. Operations also accept a PodPort directly. `search` retains the existing
ranked array output in this scaffold. HTTP, OAuth, memory, chat and capture tools are
implemented by subsequent W9 tasks.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Streamable HTTP

```ts
import { createServer } from "node:http";
import { createMcpHttpHandler } from "@jeswr/solid-mcp/http";
import { createSolidMcpServer } from "@jeswr/solid-mcp";

const handler = createMcpHttpHandler({
  resourceUrl: "https://mcp.example/mcp",
  allowedOrigins: ["https://client.example"],
  authenticate: async (request) => verifyMcpResourceToken(request.headers.get("authorization")),
  server: async (principal) => createSolidMcpServer(await podConfigFor(principal)),
});

// Node: mount this handler at /mcp, preserving the public Host behind a proxy.
createServer(handler).listen(3000, "127.0.0.1");
// Web/serverless route: return await handler(request).
```

`verifyMcpResourceToken` and `podConfigFor` above are application callbacks: verify the MCP
resource token (including audience), return a principal, and resolve that principal's pod
session on the server. Return `null`, `undefined`, or `false` (or throw) to reject authentication.
MCP bearer tokens must never be used as pod credentials. The `server` factory must return a
fresh MCP SDK `McpServer` for every request; singleton reuse is rejected.

The SDK transport runs in stateless mode with JSON responses and no session IDs. POST bodies
are capped at 1 MiB, including chunked bodies; GET, DELETE and other methods return 405 after
authentication. Invalid JSON/UTF-8 returns 400, oversized bodies return 413, and failures to
authenticate return 401 with the protected-resource metadata challenge. The application serves
that metadata separately at `<resourceUrl>/.well-known/oauth-protected-resource`.

Host must exactly match the public URL's authority, including any port. Forwarding headers do
not override this check. A Web Request without an explicit Host is checked using its URL;
Node requests require Host. An absent Origin is accepted for native clients; present origins
must exactly match `allowedOrigins`. Wildcards, opaque origins, and origin URLs with paths
are rejected at configuration time. Allowed browser origins receive explicit CORS headers and
unauthenticated POST preflight responses. No wildcard CORS or cookie credentials are enabled.

## Links

- [Source](https://github.com/jeswr/solid-mcp)
- [Issues](https://github.com/jeswr/solid-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright
