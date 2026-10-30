---
name: rdf-serialize
description: Work on @jeswr/rdf-serialize, the shared Turtle-family and context-free JSON-LD writer and IRI safety helpers.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/rdf-serialize

Use `serialize(quads, options?)`, or `legacySerialize(quads, format?, prefixes?, emptyAsEmptyString?)`
for the positional API. The default format is `text/turtle`. N-Triples, N-Quads and TriG use
`n3.Writer`; unknown formats retain its Turtle fallback. Preserve existing N3 output behavior.

`format: 'application/ld+json'` emits expanded, context-free JSON-LD using `JSON.stringify`
over freshly constructed plain objects. It always emits an array, including `[]` for an empty
dataset, ignoring `prefixes` and `emptyAsEmptyString`. Do not add a context option or any loader.

- Named and blank nodes use `@id`; blank nodes are relabelled consistently as `_:bN` per document.
- Named graphs use `@id`/`@graph`, merging any default-graph statements about the graph identifier.
- Named-node `rdf:type` objects use `@type`. Other objects retain the full predicate IRI.
- `xsd:string` uses `@value`; language literals add `@language`; other datatypes add `@type`.
  Keep lexical values as strings, including numbers, booleans and values resembling IRIs.
- Lists remain first/rest triples. No compaction, list folding, remote contexts or network access.
- Read only RDF/JS fields; never invoke caller methods or serialize their objects directly.
  Reject malformed terms and IRIs, invalid or inconsistent language/datatype fields, and all
  directional literals (including `rdf:dirLangString`) with `TypeError`.

The IRI helpers `escapeIri`, `safeHttpIri`, `safeIri` and `isHttpIri` retain their separate lexical
safety contracts. JSON-LD validates absolute IRIs without URL normalization or silent escaping.

This package is security critical. Add behavioral and adversarial tests for every writer branch,
including hand-checked expanded fixtures and round trips through the workspace devDependency
`@jeswr/fetch-rdf`. Run `lint`, `build`, `typecheck`, `test:coverage` and the root gate.
