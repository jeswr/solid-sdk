<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
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
response is also limited to 1 MiB.

`fetch` accepts `{id}` (an absolute pod URL) and returns one MCP text block
containing `{id,title,text,url,metadata}`. Titles use the decoded filename.
Metadata contains `contentType`, `truncated`, and an optional `etag`. RDF is
parsed using `@jeswr/fetch-rdf` and serialized as Turtle; `text/*` is returned as
text. Named-graph RDF is rendered as a union graph (Turtle has no graph labels).
Other media types, including non-RDF `application/json`, return empty text
and metadata without downloading the body.

Both the input and UTF-8 output are capped at 1 MiB. Text returns a complete
UTF-8 prefix and `metadata.truncated: true` when capped. Oversized RDF returns
empty text with that flag, since a partial document may be invalid RDF. Missing
Content-Type is treated as binary. JSON-LD inline contexts are supported; remote
contexts and `@import` are refused to prevent parser-initiated network requests.
All fetch URLs and redirect hops are validated against the configured pod scope.

## Links

- [Source](https://github.com/jeswr/solid-mcp)
- [Issues](https://github.com/jeswr/solid-mcp/issues)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Solid Protocol](https://solidproject.org/TR/protocol)

## License

[MIT](./LICENSE) © Jesse Wright
