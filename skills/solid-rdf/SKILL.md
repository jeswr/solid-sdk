---
name: solid-rdf
description: Use when implementing Solid server RDF parsing or serialization, JSON-LD context security, RDF content negotiation, byte-exact storage, LDP container graphs, or SPARQL PATCH parsing. Covers N3.js, jsonld, and @rdfjs/wrapper typed accessors; client pod reads use fetch-rdf.
---

<!-- AUTHORED-BY Codex GPT-6 -->

## Quick reference

Stream original stored bytes when Accept permits; convert only on the read path.
Use one N3 DataFactory, the resource URL as baseIRI, and a refusing or pinned-context-only JSON-LD loader.
Build graphs through typed accessors, serialize with the callback-based N3 Writer, and validate SPARQL ASTs before applying PATCH.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Implementation paths, ADR numbers, server-specific defaults, and commands below refer to
the original `prod-solid-server` implementation, outside this SDK checkout. They document
that server's patterns, rather than files or dependencies to install in this workspace.

# Solid RDF (Turtle / JSON-LD / N3.js / @rdfjs)

Patterns for handling RDF on a Solid/LDP server in TypeScript. Grounded in `src/rdf/`
(`formats.ts`, `conneg.ts`, `parse.ts`, `containerListing.ts`). The stack is **N3.js** (Turtle /
N-Triples / N-Quads / N3), **jsonld** (JSON-LD), **@rdfjs/wrapper** (typed graph construction), and
**@rdfjs/types** for the `Quad`/term interfaces. Use **Context7** for the exact `n3` / `jsonld` /
`@rdfjs/wrapper` / `sparqljs` APIs — this skill is the *house patterns*, not the library reference.

## When to use

Parsing or serialising RDF; handling JSON-LD; negotiating an RDF representation; building LDP
container/membership graphs; reviewing or writing any code that imports `n3`, `jsonld`,
`@rdfjs/*`, `@solid/object`, or `sparqljs`.

## The model: byte-exact storage, convert on read

The stored body is **byte-exact in its original serialisation**. RDF formats are only converted
*between* on the read path (and parsed for PATCH / container listings). So on a GET:

1. `acceptsStored(accept, storedType)` — if the client's `Accept` is satisfiable by the stored
   bytes, **stream the original bytes** (no parse/reserialise round-trip, no canonicalisation drift).
2. Otherwise `negotiateRdfType(accept)` picks the best of `RDF_MEDIA_TYPES`
   (`text/turtle`, `application/n-triples`, `application/n-quads`, `application/ld+json`),
   defaulting to **Turtle** when there's no usable preference — then parse + reserialise.

Always normalise a media type with `essence(contentType)` (strips `; charset=…` params, lower-cases)
**before comparing** — never compare raw `Content-Type`/`Accept` strings.

## Parsing (`parseRdf`)

- N3.js `Parser` handles Turtle / N-Triples / N-Quads / N3 — pass the `n3Format(type)` string and
  the resource's own URL as `baseIRI` so **relative IRIs resolve per the Solid spec**.
- JSON-LD goes through `jsonld.toRDF(..., { format: "application/n-quads" })`, then the N-Quads
  string is **re-parsed with N3** so every quad's terms come from the **same n3 `DataFactory`** as
  the rest of the pipeline. Don't mix DataFactories — term identity (`.equals`, Set membership)
  breaks across factories.
- Wrap failures in a typed `RdfParseError` → the HTTP layer maps to `400` for a client body (stored
  bytes that fail to re-parse are an internal error, since they parsed once already).

## 🔒 SSRF-safe JSON-LD (security-critical — do not skip)

A client-supplied JSON-LD `@context` can reference an arbitrary URL. **A server must never make an
outbound request because a client uploaded a document.** Always pass a document loader that refuses
every remote fetch:

```ts
const noRemoteContextLoader = (url: string): Promise<never> =>
  Promise.reject(new RdfParseError(
    `Refusing to load a remote JSON-LD @context (${url}). Provide an inline @context.`));

await jsonld.toRDF(doc, {
  format: "application/n-quads",
  base: baseIri,
  documentLoader: noRemoteContextLoader, // SSRF / unbounded-egress guard
});
```

Solid resources carry inline contexts, so this never rejects legitimate input. The same applies to
`jsonld.fromRDF` / `jsonld.expand` / `jsonld.compact` — any jsonld call that *could* dereference a
context must use the locked-down loader. If you ever need a remote vocabulary, use a **static
allowlist + a pre-fetched, pinned context cache**, never an open loader.

## Serialising (`serializeRdf`)

- N3.js for Turtle/N-Triples/N-Quads/N3. The `Writer` is **callback-based** — promisify it
  (`writer.end((err, result) => …)`); don't await it directly.
- JSON-LD by `jsonld.fromRDF` over the N-Quads serialisation (no remote context fetch).
- Unknown target type → fall back to Turtle (the default), or throw `RdfParseError` for a strict
  endpoint.

## 🏗️ House rule: build graphs with typed accessors, never hand-built triples

For any non-trivial graph (LDP container listings, ACL docs, profiles), construct it through
**`@rdfjs/wrapper`** typed mapping accessors — **never** assemble `DataFactory.quad(...)` by hand.
Hand-built triples drift from the vocabulary, miss datatype coercion, and are unreviewable. Pattern
(`containerListing.ts`):

```ts
class ListedResource extends TermWrapper {
  get types(): Set<string> {                       // rdf:type as a typed Set
    return SetFrom.subjectPredicate(this, RDF_TYPE, t => t.value, NamedNodeFrom.string);
  }
  set modified(v: Date)  { RequiredAs.object(this, DCTERMS_MODIFIED, v, LiteralFrom.dateTime); }
  set size(v: number)    { RequiredAs.object(this, POSIX_SIZE, v, LiteralFrom.integer); }
}
class ContainerListing extends DatasetWrapper {
  container(id: string) { return new ListedContainer(id, this, this.factory); }
}
// …then `[...dataset] as Quad[]` and serialise via the negotiated type.
```

`LiteralFrom.dateTime`/`.integer` produce correctly-typed literals (`xsd:dateTime`, `xsd:integer`);
`SetFrom`/`RequiredAs` keep cardinality honest. This is the same `@solid/object`/`@rdfjs/wrapper`
discipline used for ACL parsing — see the suite rule on object-mapper RDF.

## LDP container listing shape (what GET on a container returns)

- Container typed `ldp:Resource`, `ldp:Container`, `ldp:BasicContainer`.
- One `ldp:contains` triple per direct child.
- Each child typed (`ldp:Container`+`ldp:BasicContainer` if a container, else `ldp:Resource`),
  with optional `dcterms:modified` (`xsd:dateTime`) + `posix:size` (`xsd:integer`).
- Skip epoch-zero mtimes and absent sizes rather than emitting bogus values.

## SPARQL (PATCH engine)

`sparqljs` parses SPARQL-Update bodies (`application/sparql-update`) for the PATCH path — parse to an
AST and **validate read-vs-write / reject destructive ops** before applying. Build query *strings*
to QLever with strict N-Triples escaping + IRI encoding (see a dedicated `solid-sparql`/`qlever`
skill if present). Never string-concatenate untrusted lexical values into SPARQL.

## Gotchas checklist

- [ ] `essence()` every media type before comparing.
- [ ] JSON-LD parse/serialise uses the **no-remote-context loader** — every time.
- [ ] One `DataFactory` (n3's) across the whole pipeline; re-parse jsonld output through N3.
- [ ] `baseIRI` = the resource's own URL for relative-IRI resolution.
- [ ] N3 `Writer` is callback-based — promisify.
- [ ] Graphs built via `@rdfjs/wrapper` typed accessors, not hand-built quads.
- [ ] Stream byte-exact stored bytes when `Accept` allows; only parse+reserialise on conversion.

## See also

- Code: `src/rdf/{formats,conneg,parse,containerListing}.ts`, the PATCH engine, `src/authz/` (ACL
  parsing reuses the wrapper discipline).
- Libraries (via **Context7**): `n3`, `jsonld`, `@rdfjs/wrapper`, `@rdfjs/types`, `sparqljs`,
  `@solid/object`.
- Specs: Solid Protocol, W3C LDP, RDF 1.1 Turtle / JSON-LD 1.1 / N-Quads.
