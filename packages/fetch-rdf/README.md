# @jeswr/fetch-rdf

Canonical fetch + parse helpers for Solid RDF resources.

Two functions, one error class. `parseRdf` dispatches a body
(string or `ReadableStream<Uint8Array>`) on its `Content-Type`,
streaming chunks straight into an `N3.Store`. `fetchRdf` orchestrates
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
