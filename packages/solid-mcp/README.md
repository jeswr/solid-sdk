<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/solid-mcp

An MCP server that exposes a Solid pod as scoped resources and read, search, list, and write tools.

The caller supplies authentication. Access is confined to one pod root, and writes are disabled by
default.

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

The bundled `solid-mcp` CLI reads `SOLID_MCP_POD_ROOT`, optional `SOLID_MCP_WEBID`, and
`SOLID_MCP_READONLY`. Programmatic construction is required for an authenticated fetch today.

## Key API

- Server: `createSolidMcpServer`, `SolidMcpConfig`.
- Operations: `listContainer`, `readResource`, `readRdf`, `search`, `writeResource`.
- Scope: `normalizePodRoot`, `requirePodScopedUrl`, `podScopedUrlOrUndefined`.
- Data seam: `PodPort`, `createFetchPodPort`, `PodConditions`.
- Registry: `createPodToolRegistry`, `registerPodTools`, `PodTool` (Zod schema, handler, readOnly flag).
- MCP tools: `pod_list`, `pod_read`, `search`, `fetch`, and opt-in `pod_write`.
- One-release aliases in v0.2: `solid_list`, `solid_read`, `solid_search`, `solid_write`.
  List/read/write aliases retain the same schemas, output and read-only enforcement.
  `solid_search` retains its optional scope and ranked array response.

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
off-pod profile redirects are refused. Client tools and resources are always confined to the pod root. A custom PodPort
must enforce its data boundary and mutation policy too.
Every tool, including `fetch` and both search names, uses the injected port's current
`read` and `list` methods. Authorization decorators, filtered listings, and redacted
read results remain authoritative. Fetch-backed streaming and parsing limits are
enforced inside that boundary.
Search records a match only after the target read succeeds, including matches
based solely on a Type Index hint, filename or URL. Read denials discard the
candidate; an authorized read with no matching RDF literal can still match by name.
Container tools and MCP resource listings authorize the container and each child
before returning metadata, omitting unreadable children.
Decorated reads receive complete bodies up to the input limit; larger downloads
fail closed so a content-based authorization check cannot inspect a partial body.

The existing fetch-based server configuration and exported pod operations remain
supported. Operations also accept a PodPort directly. The programmatic `search` operation retains its ranked array output; the MCP
`search` tool returns the ChatGPT envelope described below.

## ChatGPT search and fetch

`search` accepts `{query}` and returns one MCP text block containing JSON:
`{results:[{id,title,url}]}`. IDs are pod resource URLs. It searches Type Index
registrations and container listings, matching names, URLs, and RDF literals
(including memory notes and chat titles). Results are deduplicated and ranked.
The legacy `solid_search` tool retains its original array response.

The shared discovery/scan limits default to depth 4, 500 distinct resources, and
5000 ms. Set `searchLimits: {maxDepth, maxResources, maxTimeMs}` in the server
configuration to override them. Discovery, redirect hops, and hinted resources
consume the same resource budget. A deadline returns the matches found so far;
the exact search response has no additional completeness fields. Each scanned
response is also limited to 1 MiB. Direct Type Index instances are negotiated
as RDF even when their URLs have no file extension.

`fetch` accepts `{id}` (an absolute pod URL) and returns one MCP text block
containing `{id,title,text,url,metadata}`. Titles use the decoded filename.
Metadata contains `contentType`, `truncated`, and an optional `etag`. RDF is
parsed with bounded N3/JSON-LD parsers and serialized as Turtle; `text/*` is
returned as text. Named-graph RDF is rendered as a union graph (Turtle has no graph labels).
Other media types, including non-RDF `application/json`, return empty text
and metadata without downloading the body through an undecorated fetch-backed adapter.
Custom PodPorts return byte arrays and must bound their own backend reads; the
server still bounds parsing and tool output.

Both the input and UTF-8 output are capped at 1 MiB. Text returns a complete
UTF-8 prefix and `metadata.truncated: true` when capped. Oversized RDF returns
empty text with that flag, since a partial document may be invalid RDF. Missing
Content-Type is treated as binary. JSON-LD inline contexts are supported; remote
contexts and `@import` are refused to prevent parser-initiated network requests.
Parsing stops before storing more than 16,384 quads (including duplicate input
statements), 1 MiB of expanded term values, or 1 MiB of term bytes across quads.
N3-family structural nesting is capped at 64 levels; pending contexts and
generated blank nodes also consume the shared 1 MiB allocation budget.
The Turtle writer retains at most 1 MiB and stops as soon as its output exceeds
that limit. These parsing budgets also apply to search profiles, Type Indexes,
container listings, and literal reads; search skips documents that exceed them.
All fetch URLs and redirect hops are validated against the configured pod scope.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Chat tools

All three tools use `@jeswr/solid-chat-interop`'s reusable `ChatWriter` and require
`webId` to identify the owner. `chat_save` also requires `readOnly:false`.

- `chat_save({provider, conversationId, title, messages})` returns `{url, saved, skipped}`.
  Messages are `{id?, role, text, createdAt}`. Providers: `claude`, `chatgpt`, `codex`.
  Roles: `system`, `user`, `assistant`, `tool`; dates require an explicit timezone.
- `chat_list({provider?, since?, cursor?, limit?})` returns `{conversations, nextCursor?}`.
  Summaries include URL, provider, conversation ID, title and latest message time
  (`updatedAt`, absent for empty conversations). URL order and an exclusive cursor
  provide paging; `since` is exclusive against latest message time, before paging.
  Limit defaults to 20, maximum 100. Reuse filters when following a cursor.
- `chat_get({provider, conversationId})` returns the conversation plus its URL and
  messages ordered by time, then ID.

Storage is `<podRoot>private/chats/<provider>/<conversationId>/`, with owner-only
WAC ACLs written before chat content and create-only message PUTs using
`If-None-Match: *`. First title and message contents win; retrying an existing ID
skips it. IDs use 1–200 letters, digits, underscores or hyphens. Omitted message IDs
are deterministic hashes; capture callers should supply source IDs to distinguish
otherwise identical events. The fetch adapter retains pod-scope and redirect checks
and accepts only Turtle/N3-family RDF for chats, preventing remote JSON-LD context
loads. Servers must support the ACL-before-content sequence; errors fail closed.
ACL discovery uses HEAD and a unique WAC `rel="acl"` Link, including on 404 for
containers not yet created. Missing/ambiguous ACL links, ACP and unsafe ACL URLs
abort saves; ACL associations are rechecked after container creation. Writes refuse
all redirects. Listing skips containers whose conversation metadata returns 404,
while preserving permission, transport and message-read errors.

Chat tools are registered alongside the canonical pod tools and compatibility
aliases when using the fetch-based server configuration. The chat adapter retains
its ACL discovery and write safeguards. The portable `PodPort` configuration
registers only pod tools because `PodPort` does not expose ACL discovery.

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
that metadata separately, by default at the RFC 9728 §3.1 location returned by
`protectedResourceMetadataUrl(resourceUrl)`, using the OAuth server's well-known insertion rule:
`https://mcp.example/mcp` advertises
`https://mcp.example/.well-known/oauth-protected-resource/mcp`; a root resource advertises
`https://mcp.example/.well-known/oauth-protected-resource`. Both the transport and
`@jeswr/mcp-oauth` use `metadataUrl` from `@jeswr/mcp-oauth/metadata` to construct this URL.
Pass `resourceMetadataUrl` to advertise another URL, for example
`oauth.protectedResourceMetadataUrl()` from the composed authorization server.

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
