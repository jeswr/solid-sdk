---
name: pkg-memory
description: Use when building, serializing, or parsing PKG nanopublications and the eight typed memory fact templates.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# PKG nanopublications

Use `createFactAssertion` for structured facts, `buildNanopublications` for batches,
`serializeNanopublications` for TriG, and `parseNanopublications` to read it back.
The owner WebID is mandatory; never default to a real person's identity.

RDF writes use `@rdfjs/wrapper`, reads use graph-scoped typed accessors, parsing uses
`@jeswr/fetch-rdf`, and serialization uses `@jeswr/rdf-serialize`. Keep assertion
canonicalization compatible with RDFlib 7's builder; RDFC-1.0 labels are different.

Use only fictional `example.org` identities in fixtures. The five synthetic claims
and Python-generated expected outputs in `test/fixtures` replace private pilot data.
Supply source digests explicitly; this data-model package never reads source files.
Belief classification, purpose filtering, and pod storage belong to MCP-05.
