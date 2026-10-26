<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

> Experimental — AI-agent-generated. Maintained in `jeswr/solid-sdk`; the standalone repository is a read-only build mirror.

# @jeswr/fetch-rdf

Canonical fetch + parse helpers for Solid RDF resources.

Two functions, one error class. `parseRdf` dispatches a body
(string or `ReadableStream<Uint8Array>`) on its `Content-Type`.
Stream bodies feed chunks straight into an `N3.Store`; already-buffered
Turtle, N-Triples, N-Quads and TriG strings use n3's synchronous parser
and settle without waiting for stream lifecycle events. `fetchRdf` orchestrates
an HTTP GET + parse and returns the dataset alongside the response
headers.

This package is the single home for these helpers in Jesse Wright's
Solid workspace.

## Install

```sh
npm install @jeswr/fetch-rdf
```

Sub-packages in this workspace pull it via a file dep; other repos via
a git dep:

```jsonc
// file dep (sub-repos in this workspace)
"@jeswr/fetch-rdf": "file:../fetch-rdf"

// git dep (everything else, until we publish)
"@jeswr/fetch-rdf": "github:jeswr/fetch-rdf#main"
```

## Usage

```ts
import { parseRdf, fetchRdf, RdfFetchError } from '@jeswr/fetch-rdf';

// Fetch + parse — the common case.
const { dataset, headers } = await fetchRdf(
  'https://alice.example/profile/card',
  { fetch: authFetch }, // optional; defaults to globalThis.fetch
);
const etag = headers.get('etag');
const contentType = headers.get('content-type');

// Pure parse — when you already have a body in hand.
const ds = await parseRdf(turtleBody, 'text/turtle', {
  baseIRI: 'https://alice.example/profile/card',
});
```

`dataset` is an [`N3.Store`](https://github.com/rdfjs/N3.js#storing),
which implements `RDF.DatasetCore`/`RDF.Dataset`/`RDF.Store`.

The result also retains the legacy `etag`, `url`, `contentType`, and `response`
fields: `etag` is the unmodified validator or `null`; `url` is the final response
URL (falling back to the requested URL); `contentType` is the lowercase media
type without parameters, or `null`; `response` is the original consumed response.

### JSON-LD remote contexts

Inline contexts work offline. Remote contexts are refused by default with
`RdfFetchError`. This package ships no bundled remote contexts. Pass an explicit
`documentLoader` to `parseRdf` or `fetchRdf` to opt in:

```ts
import { createFetchDocumentLoader, fetchRdf } from '@jeswr/fetch-rdf';

const documentLoader = createFetchDocumentLoader(authFetch, {
  allow: url => url === 'https://example.org/contexts/profile.jsonld',
});
const result = await fetchRdf(resourceUrl, { fetch: authFetch, documentLoader });
```

The helper checks every context URL before fetching, uses only the supplied
transport, and refuses redirects. Nested remote contexts must also be allowlisted.
An offline loader can instead implement `{ async load(url) { /* return context */ } }`.

### `Accept`

`fetchRdf` always sends:

```
text/turtle, application/ld+json;q=0.9
```

Solid Protocol §5.2 only requires servers to support these two RDF
media types, and they are the only formats we know how to parse — so
the header is fixed rather than tunable.

### Errors

Everything throws `RdfFetchError`. The error carries discriminator
fields so callers can branch without string-matching the message:

```ts
try {
  await fetchRdf(url);
} catch (err) {
  if (err instanceof RdfFetchError) {
    if (err.status === 404) { /* … */ }
    if (err.status === 401) { /* … */ }
    if (!err.status) { /* network or parse failure */ }
  }
}
```

## Supported media types

| Media type                | Parser                       |
| ------------------------- | ---------------------------- |
| `text/turtle`             | `n3`                         |
| `application/n-triples`   | `n3`                         |
| `application/n-quads`     | `n3`                         |
| `application/trig`        | `n3`                         |
| `application/ld+json`     | `jsonld-streaming-parser`    |

Anything else throws. We deliberately do not pull in `rdf-parse`: it
ships every RDF serialisation we don't need for Solid and complicates
browser bundling. If your use case genuinely needs RDF/XML, parse it
yourself before handing the dataset to your code.

## Why not `rdf-parse`?

- Solid only uses Turtle and JSON-LD in practice (Solid Protocol §5.2).
- `rdf-parse` requires a `Readable` source — a friction point in the
  browser where we have a `string` body.
- Bundle-size and tree-shake behaviour are markedly better here.

## License

MIT — Jesse Wright.
