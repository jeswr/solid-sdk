---
name: solid-fetch-rdf
description: Use when fetching or parsing RDF with @jeswr/fetch-rdf, handling RdfFetchError, retaining ETags for conditional writes, or choosing the sanctioned Solid RDF read path.
---
<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Read RDF with `@jeswr/fetch-rdf`

`@jeswr/fetch-rdf` lives in `packages/fetch-rdf`. Workspace consumers use `workspace:*`; the standalone `jeswr/fetch-rdf` repository is a read-only build mirror.

```ts
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";

const { dataset, headers } = await fetchRdf(resourceUrl, {
  fetch: authenticatedFetch,
});
const etag = headers.get("etag");
```

## Rules

- Use `fetchRdf` for network reads and `parseRdf` when bytes are already available. Do not duplicate content-type dispatch with an inline N3 parser.
- Inject the correct fetch explicitly at security boundaries. Do not assume a patched global when code can run before auth initialization or against a foreign origin.
- Retain the returned ETag for conditional writes. Handle `null` for servers that do not supply one.
- Branch on `RdfFetchError` and its structured status fields; do not string-match error messages.
- Pass the resource URL as `baseIRI` when parsing relative RDF identifiers.
- Treat the returned dataset as RDF/JS `DatasetCore`; wrap it with package or local `@rdfjs/wrapper` accessors.
- Serialize writes with `n3.Writer`, use explicit RDF content type, and apply conditional `PUT` where an ETag exists.
- Before writing to a user-configured pod base, use `@jeswr/guarded-fetch`'s pod-scope guard instead of another path-prefix implementation.
- Before constructing RDF terms from untrusted IRIs, use `@jeswr/rdf-serialize` to escape forbidden IRIREF characters and enforce scheme policy.

Remote JSON-LD contexts are refused by default. For a trusted remote context, pass
`documentLoader: createFetchDocumentLoader(authenticatedFetch, { allow: url => allowedUrls.has(url) })`
to `fetchRdf` or `parseRdf`. The helper refuses redirects and checks nested contexts too.
For offline ActivityStreams contexts, supply an explicit `{ load }` loader returning
only bundled allowlisted contexts; this package does not bundle contexts itself.

Pass `engine` to opt into `RdfEngine.parse`; fetch-rdf buffers stream input on this
path and returns the engine dataset as `DatasetCore`. The default path still returns
an N3 Store and streams input. The caller owns and disposes the engine; fetch-rdf
uses its own structural `RdfParser` interface and has no production or type
dependency on rdf-engine. `documentLoader` applies only to the default JSON-LD parser:
Sparq 0.1.5 rejects remote contexts. Use real Node WASM in parser parity tests.

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-data-modeler` persona from
[`.claude/agents/solid-data-modeler.md`](../../.claude/agents/solid-data-modeler.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
