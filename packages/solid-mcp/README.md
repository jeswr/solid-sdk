<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-mcp

An MCP server that exposes a Solid pod as scoped resources and read, search, list, and write tools.

Library callers supply authentication; the stdio CLI supports CSS client credentials.
Access is confined to one pod root, and writes are disabled by default.

> Experimental. Review the scope and keep `readOnly: true` unless the MCP client should modify pod
> data.

## Install

```sh
npm install github:jeswr/solid-mcp#main "@modelcontextprotocol/sdk@^1.29"
```

Requires Node.js 24 or newer in the suite workspace.

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
- MCP tools: `solid_list`, `solid_read`, `solid_search`, and opt-in `solid_write`.

## Links

- [Source](https://github.com/jeswr/solid-mcp)
- [Issues](https://github.com/jeswr/solid-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright
