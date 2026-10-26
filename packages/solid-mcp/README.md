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
off-pod profile redirects are refused. Client tools and resources are always confined to the pod root. A custom PodPort
must enforce its data boundary and mutation policy too.

The existing fetch-based server configuration and exported pod operations remain
supported. Operations also accept a PodPort directly. `search` retains the existing
ranked array output in this scaffold. HTTP, OAuth, memory and capture tools are
implemented by subsequent W9 tasks.

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

## Links

- [Source](https://github.com/jeswr/solid-mcp)
- [Issues](https://github.com/jeswr/solid-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright
