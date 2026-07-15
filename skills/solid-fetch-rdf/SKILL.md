---
name: solid-fetch-rdf
description: Use when fetching or parsing RDF with the external @jeswr/fetch-rdf dependency, handling RdfFetchError, retaining ETags for conditional writes, or choosing the sanctioned Solid RDF read path.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Read RDF with `@jeswr/fetch-rdf`

`@jeswr/fetch-rdf` is currently an external workspace dependency, not a package directory in this monorepo. Use it for Solid RDF GET and parse operations; move this skill beside `packages/fetch-rdf` when that package is imported.

```ts
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";

const { dataset, etag, contentType, response, url } = await fetchRdf(resourceUrl, {
  fetch: authenticatedFetch,
});
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

Do not parse untrusted ActivityStreams JSON-LD with a loader that can fetch arbitrary remote contexts. Use a bundled allowlisted context and a refusing `documentLoader` on server request paths.

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-data-modeler` persona from
[`.claude/agents/solid-data-modeler.md`](../../.claude/agents/solid-data-modeler.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
