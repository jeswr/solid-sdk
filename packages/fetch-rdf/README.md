<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

> Experimental — AI-agent-generated. Maintained in `jeswr/solid-sdk`; the standalone repository is a read-only build mirror.

# @jeswr/fetch-rdf

Canonical fetch + parse helpers for Solid RDF resources. Pure ESM, Node ≥24.

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

Workspace consumers use `"@jeswr/fetch-rdf": "workspace:*"`. External consumers
install the npm package or use an existing build-mirror git pin.

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

By default, `dataset` is an [`N3.Store`](https://github.com/rdfjs/N3.js#storing),
which implements `RDF.DatasetCore`/`RDF.Dataset`/`RDF.Store`.

The result also retains the legacy `etag`, `url`, `contentType`, and `response`
fields: `etag` is the unmodified validator or `null`; `url` is the final response
URL (falling back to the requested URL); `contentType` is the lowercase media
type without parameters, or `null`; `response` is the original consumed response.

### Security and cancellation

The default transport is `globalThis.fetch`: browser-safe and transport-neutral.
**Server-side callers handling untrusted URLs must inject a guarded fetch**, such
as `createNodeGuardedFetch` from `@jeswr/guarded-fetch/node`, to enforce address
policy and DNS pinning. This library does not prevent SSRF. Inject an authenticated
fetch explicitly for protected resources; selecting the global does not provide
authentication by itself. An injected transport remains responsible for credentials
it adds itself and for generating any URL-bound DPoP proofs.
The guarded transport must honour `redirect: "manual"` (`@jeswr/guarded-fetch` does since PR #238).

Native redirect following is unchanged when caller headers are limited to `Accept`,
`Accept-Language`, `Cache-Control`, `Pragma`, `If-None-Match` and `If-Modified-Since`.
Supplying any other request header enables manual redirect handling: at most ten
HTTP(S) hops, retaining headers on same-origin hops and dropping every caller
header except `Accept` on a cross-origin hop (also on subsequent hops back).
All requests are GETs, including after 301/302/303. Non-HTTP(S) locations and browser
`opaqueredirect` responses reject with `RdfFetchError` (`code: "REDIRECT"`). The
context loader always refuses redirects. A guarded transport may refuse redirects
more strictly. Response metadata and relative-IRI resolution use the final URL.

Both functions accept `signal`. Aborting rejects promptly with the signal's reason (an `AbortError` by default, as native fetch does),
cancels body reads and signals context loads; no dataset is returned. A custom
loader receives an optional second argument `{ signal, maxBytes, maxJsonDepth }` and should pass
the signal to its I/O. Opaque engine/custom-loader work that ignores cancellation
may continue internally, but its late result cannot complete the operation.

### Parse budgets

`ParseRdfOptions` and `FetchRdfOptions` accept these finite, nonnegative integer
limits (`maxContextConcurrency` must be positive). Increase them explicitly for
larger trusted resources. Exceeding a budget rejects with `RdfFetchError`
(`code: "PARSE_LIMIT"`) and cancels the input without waiting for cleanup.

| Option | Default | Meaning |
| --- | --- | --- |
| `maxBytes` | 16 MiB (16,777,216) | UTF-8 input bytes, checked during body reads and before parsing strings; also bounds the engine buffer and each helper-loaded context response. |
| `maxJsonDepth` | 128 | Nested JSON objects and arrays in default-parser JSON-LD documents and loaded contexts; the root container counts as depth 1. |
| `maxQuads` | 1,000,000 | Constructed quads, counting duplicates before dataset deduplication. |
| `maxTermLength` | 1 MiB (1,048,576 characters) | Each expanded term value, including IRI, literal, graph and datatype values. |
| `maxTotalTermLength` | 64 MiB (67,108,864 characters) | Aggregate constructed term characters and aggregate term values across quads (each bounded independently), including repeats, datatype IRIs and language tags. |
| `maxContextRequests` | 32 | Context load attempts per parse after coalescing in-flight duplicates, including nested contexts. |
| `maxContextConcurrency` | 4 | Simultaneous context loads per parse; excess requests queue. |

Character budgets count JavaScript UTF-16 code units, rather than UTF-8 bytes.
Term construction and quad budgets run inside the parser's data factory before
terms enter expansion buffers or quads enter the dataset. JSON depth is checked on
raw text before each chunk reaches the JSON-LD parser, preserving string and escape
state across chunks. The context helper checks raw text while reading, before
`JSON.parse`; custom-loader objects are checked iteratively before parser handoff.
These limits do not provide a general CPU budget.

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
In-flight requests for the same URL coalesce within each parse. The helper also
coalesces calls sharing an operation signal. Its options additionally accept
`signal`, `timeoutMs` (per-context deadline, including body reading; no default
deadline) and `maxBytes` (default 16 MiB). The effective context byte limit is the
smaller of the helper limit and the parse limit. A deadline rejects parsing with
`AbortError` and aborts other context loads.

An offline loader can return only bundled allowlisted contexts:

```ts
const documentLoader = {
  async load(url: string) {
    if (url === 'https://www.w3.org/ns/activitystreams') return bundledAs2Context;
    throw new Error('Context refused');
  },
};
const dataset = await parseRdf(body, 'application/ld+json', { documentLoader });
```

### Optional RDF engine

Pass an existing `RdfEngine` to opt into `@jeswr/rdf-engine` parsing:

```ts
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { fetchRdf, parseRdf } from "@jeswr/fetch-rdf";

const engine = createRdfEngine();
try {
  const { dataset } = await fetchRdf(resourceUrl, { fetch: authenticatedFetch, engine });
  const parsed = await parseRdf(turtle, "text/turtle", { baseIRI: resourceUrl, engine });
  // dataset and parsed expose RDF/JS DatasetCore.
} finally {
  engine.dispose();
}
```

Without `engine`, parsing and `Store` return types stay unchanged. With `engine`,
stream bodies are bounded by `maxBytes` and buffered, then passed to `engine.parse`
(which applies its own parse limits) without a second parse; the result is checked
against `maxQuads` and returned directly,
typed as `DatasetCore` (`FetchedRdf<DatasetCore>` for fetch results). Engine failures
are wrapped in `RdfFetchError`, preserving their cause, media type and resource URL.
Term-length and JSON-depth budgets apply only to the default parser. The caller owns the engine lifecycle. The `engine` option accepts the exported
structural `RdfParser` interface: only `parse(string, mediaType, { baseIri? })`
returning `Promise<DatasetCore>` is required. fetch-rdf has no production or type
dependency on rdf-engine; callers provide it separately. The default path does
not initialize WASM.

The engine's JSON-LD support applies on this path: Sparq 0.1.5 refuses remote
contexts. `documentLoader` configures only the default JSON-LD parser; use that
path for allowlisted remote contexts.

### `Accept`

`fetchRdf` always sends:

```
text/turtle, application/ld+json;q=0.9
```

Solid Protocol §5.2 only requires servers to support these two RDF
media types. The fixed header advertises those two; the parser additionally
accepts N-Triples, N-Quads and TriG responses. Caller `headers.accept` is overridden;
there is no separate `accept` option or exported `DEFAULT_ACCEPT`.

### Errors

Fetch and parse failures throw `RdfFetchError`; cancellation throws the abort reason (`AbortError` by default). The error carries discriminator
fields so callers can branch without string-matching the message. Its optional
`code` identifies `PARSE_LIMIT` or `REDIRECT` failures. Error messages, `.url` and
nested causes redact URL userinfo, query and fragment; successful response
metadata retains the actual final URL. Safe causes retain their identity:


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
