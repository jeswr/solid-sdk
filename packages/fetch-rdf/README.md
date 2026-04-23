# @jeswr/fetch-rdf

Canonical fetch + parse helpers for Solid RDF resources.

Two functions, one error class. `parseRdf` dispatches a string body on
its `Content-Type`; `fetchRdf` orchestrates an HTTP GET + parse and
returns a parsed dataset alongside the strong-validator `ETag` and the
raw `Response`.

This package is the single home for these helpers in Jesse Wright's
Solid workspace. Other packages (`@jeswr/solid-patch`,
`@jeswr/solid-reactive-fetch`, future apps) consume it instead of
re-implementing the same dispatch.

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
const { dataset, etag, contentType, response, url } = await fetchRdf(
  'https://alice.example/profile/card',
  { fetch: authFetch }, // optional; defaults to globalThis.fetch
);

// Pure parse — when you already have a body in hand.
const ds = await parseRdf(turtleBody, 'text/turtle', {
  baseIRI: 'https://alice.example/profile/card',
});
```

### Default `Accept`

`fetchRdf` defaults to:

```
text/turtle, application/ld+json;q=0.9
```

Solid Protocol §5.2 only requires servers to support these two RDF
media types, and Turtle is the dominant choice in the wild. Override
with `accept` if you need something else.

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
