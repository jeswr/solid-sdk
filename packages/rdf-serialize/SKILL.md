---
name: rdf-serialize
description: Use when working on @jeswr/rdf-serialize, the shared Turtle-family and context-free JSON-LD writer, IRI safety helpers, and typed graph helpers at /wrapper.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/rdf-serialize

Use `serialize(quads, options?)`, or `legacySerialize(quads, format?, prefixes?, emptyAsEmptyString?)`
for the positional API. The default format is `text/turtle`. N-Triples, N-Quads and TriG use
`n3.Writer`; unknown formats retain its Turtle fallback. Preserve valid RDF's lexical identity.
Before N3, rebuild every quad from validated RDF/JS fields using the factory, without invoking
caller methods or trusting private IDs. Reject invalid term positions, non-string fields,
IRIREF-forbidden IRIs (including lone surrogates; relative references such as `<>` stay legal), malformed language tags
(`/^[a-zA-Z]+(-[a-zA-Z0-9]+)*$/`), and inconsistent language/datatype/direction combinations
with TypeError. Relabel unsafe blank-node labels consistently without colliding with existing
labels. Preserve valid language/direction fields, including language-tag spelling; leave literal escaping to N3.
Preserve existing N3 Patch variable support in every triple position, including the
line-mode writer, after validating SPARQL VARNAME without a leading digit. Only language
literals carry direction: N3's direction getter also misreads `--` in datatype IRIs.

Filter prefixes in every N3 format for both APIs: reject invalid PN_PREFIX labels; omit dotted
labels, any label whose `name:` starts an input IRI in any term position or literal datatype,
and namespaces containing regex metacharacters N3 does not escape. Lexically escape other
namespaces. Keep the storage-client copy until its separate delegation follow-up.

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

Import typed graph helpers from `@jeswr/rdf-serialize/wrapper`, a separate subpath:

- `objectTerms(node, ...predicates)` preserves RDF term types. One predicate returns the
  live `SetFrom.subjectPredicate` set, including dataset mutations through `add`, `delete`,
  and `clear`. Multiple predicates return a detached snapshot, unioned in predicate order
  and de-duplicated by RDF equality with first-seen order. No predicates yields an empty set.
- `addIriTriple(node, predicate, objectIri)` escapes object IRIs with `escapeIri` without
  checking the scheme. Keep field-specific validation at the caller.
- `addHttpIriTriple(node, predicate, objectIri)` uses `safeHttpIri`, returns false and writes
  nothing for unsafe objects, and returns true after adding an escaped HTTP(S) object.
- `addLiteralTriple(node, predicate, value, datatype?)` defaults to xsd:string and uses
  `LiteralFrom.datatypeTuple` for an explicit datatype, preserving the lexical value.

These writes use the node's factory and dataset. Predicates and optional datatype IRIs must
be trusted vocabulary constants; subjects must already be safe. Do not use these helpers to
replace a caller's stricter reject/drop policy or its canonical/legacy alias policy. A union
snapshot cannot replace a mutable alias view. Never hand-build terms or Turtle.

`api:check` runs separate root and `/wrapper` API Extractor configurations and reports in `etc/`.
Keep both public entry points covered without adding wrapper exports to the root.

This package is security critical. Add behavioral and adversarial tests for every writer branch,
including hand-checked expanded fixtures and round trips through the workspace devDependency
`@jeswr/fetch-rdf`. Run `lint`, `build`, `typecheck`, `test:coverage` and the root gate.
