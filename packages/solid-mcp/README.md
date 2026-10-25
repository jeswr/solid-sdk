<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-mcp

An MCP server that exposes a Solid pod as scoped resources and read, search, list, and write tools.

The caller supplies authentication. Access is confined to one pod root, and writes are disabled by
default.

> Experimental. Review the scope and keep `readOnly: true` unless the MCP client should modify pod
> data.

## Install

```sh
npm install github:jeswr/solid-mcp#main "@modelcontextprotocol/sdk@^1.29"
```

Requires Node.js 22.19 or newer.

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

The bundled `solid-mcp` CLI reads `SOLID_MCP_POD_ROOT`, optional `SOLID_MCP_WEBID`, and
`SOLID_MCP_READONLY`. Programmatic construction is required for an authenticated fetch today.

## Key API

- Server: `createSolidMcpServer`, `SolidMcpConfig`.
- Operations: `listContainer`, `readResource`, `readRdf`, `search`, `writeResource`.
- Scope: `normalizePodRoot`, `requirePodScopedUrl`, `podScopedUrlOrUndefined`.
- MCP tools: `solid_list`, `solid_read`, `solid_search`, and opt-in `solid_write`.

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
