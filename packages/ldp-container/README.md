<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/ldp-container

Browser-safe LDP container listings shared by solid-memory, unstorage-solid, and y-solid.
This security-critical package filters attacker-controlled `ldp:contains` URLs. It has no
mirror repository configured.

```ts
import { readContainerMembers } from "@jeswr/ldp-container";

const members = await readContainerMembers(authenticatedScopedFetch, containerUrl, {
  scope: podBase,
  package: "my-app",
});
```

`readContainerMembers(fetch, containerUrl, { scope, package?, signal?, maxBytes?, maxQuads? })`
checks the request target, GETs Turtle or JSON-LD, and returns `null` on 404/410. Other HTTP failures throw with the
selected package prefix (default `[ldp-container]`). Supply a fetch that enforces your
redirect and credential policy; this helper does not wrap or replace that policy.
Missing and non-ok response bodies are cancelled best effort without awaiting cancellation.
The response body stream goes directly to `fetch-rdf`'s `parseRdf`, with a default `maxBytes`
of 16 MiB and optional `maxQuads` (fetch-rdf defaults to 1,000,000). Limits reject with
`RdfFetchError.code === "PARSE_LIMIT"` and cancel the stream. `signal` covers both fetch and
parsing, including a stalled body; abort rejects with `AbortError`. An empty null body is
parsed as an empty listing. Requires a fetch-rdf build with
`ParseRdfOptions.maxBytes`, `maxQuads`, and `signal` support.

`parseContainerMembers(dataset, containerUrl, { scope, allowRoot? })` works on an RDF/JS
`DatasetCore` without fetching. It reads membership through `@solid/object` and returns
`ContainerMember[]` (`{ url, container }`) in listing order, deduplicated by canonical URL.
Only NamedNode members are accepted; literals and blank nodes are skipped. Malformed,
foreign, escaping, credential-bearing, non-HTTP(S), and encoded-path-delimiter members are
skipped individually. Every member must pass both the overall scope guard and a strict
descendant guard rooted at `containerUrl`. Ancestors, siblings, and the listed container
itself (including query/fragment and slashless aliases) are always omitted. `allowRoot`
controls the overall scope check and cannot relax strict container containment. Container
classification uses the URL pathname's trailing slash.

Supply a single-container dataset: `ContainerDataset` selects its first container subject
(the first `ldp:contains` subject), independently of `containerUrl`. Mixed-container datasets
are unsupported. `containerUrl` supplies relative-IRI resolution and the containment boundary;
it does not select a subject from the dataset.

Import scope guards directly from `@jeswr/guarded-fetch`. Callers retain application-specific
filters, compatibility guards, any stricter read limits, and sorting.

`buildListingDataset(containerUrl, entries)` builds a synthetic RDF/JS `Quad[]` through
generated accessors. Each `ListingMetadata` supplies `url`, `title`, `modified: Date | null`,
`size: number | null`, `contentType: string | null`, and `types: readonly string[]`.
It emits `ldp:contains`, `dct:title`, optional `dct:modified` (`xsd:dateTime`), `posix:size`
(`xsd:integer`), `dct:format`, and only the supplied `rdf:type` IRIs. Null fields are omitted;
zero and empty strings are preserved. Generated guards reject unsafe subject/type IRIs and
drop invalid optional values, including fractional or non-finite sizes. Invalid dates still
throw `RangeError`. It performs no I/O or pod-scope checks: callers validate HTTP(S) and scope
policy and select the complete listing before replacing a cached graph.

The generation inputs are `codegen/listing.ontology.ttl`, `codegen/listing.shapes.ttl`, and
`codegen.config.json`. This is a local synthetic-listing profile over standard LDP/DCT/POSIX
terms, with no federation-sector profile to narrow. Fields are sets so repeated entries
retain all supplied values; text sanitization is disabled to preserve literal contents.
The facade instantiates generated wrappers without `build()` or `mark()`, so no LDP types
are inferred. `@jeswr/model-runtime` supplies every accessor; no vocabulary wrapper is handwritten.

One profile exception remains for the generator follow-up from sst-v1gn: an explicit
`sh:property [ sh:path rdf:type ; sh:nodeKind sh:IRI ; sh:minCount 0 ]` fails closed admission
with `[invalid-read-alias] ... rdf:type is a reserved structural predicate`.
The generated wrapper's built-in `.types` set already writes validated IRI objects, so only
that property shape is omitted; no handwritten accessor or admission bypass is needed.
`test/codegen.test.ts` pins the rejection for a maintainer-filed generator bead.

Build the generator, then run `pnpm --filter @jeswr/ldp-container run codegen` to regenerate
`src/generated/`; never edit those artifacts directly. The drift test runs
`pnpm run codegen --out <tmp>` and compares every artifact byte-for-byte, including the lockfile.
The package build copies the generated JS/declarations to `dist/generated/`.
