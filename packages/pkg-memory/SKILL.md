---
name: pkg-memory
description: Build, parse and classify PKG nanopublications, enforce purpose policies, and store memory through PodPort.
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
Use `classifyNanopublications` for derived belief views; acting on a fact also
requires Current validity. Preserve graph-scoped provenance when assertions are
shared. Past/revised claims stay in history; Mentioned is never an inference input.

Use `purposeFilter(policy, purpose, clientId)` on every personal-data read. It
requires an ODRL permit for every category and denies uncategorized data and
outstanding duties. `isSpecialCategory` uses a local list; it does not fetch DPV
or infer arbitrary subclasses. The two purpose tokens are ServiceProvision and
Personalisation. Never expose rejected values in a denial message.
