---
name: model-runtime
description: Use when loading a generated domain model (model.js from @jeswr/federation-codegen), calling defineModel on a shape-manifest, reading or writing pod RDF through generated entities, or changing the audited guard set in @jeswr/model-runtime.
---
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Generated-model runtime

`@jeswr/model-runtime` lives in `packages/model-runtime` and is security-critical. It is the
one interpreter for every generated domain model: a generated `model.js` inlines a JSON
shape-manifest and calls `defineModel(manifest)`; all behaviour lives here.

```ts
import model, { entities } from "./generated/model.js"; // emitted by federation-codegen

const bookmark = entities.Bookmark;
const store = bookmark.build(resourceUrl, { url: "https://example.org/a" }); // n3 Store
const data = bookmark.parse(resourceUrl, dataset);      // object | undefined (fail-closed)
const ttl = await bookmark.serialize(resourceUrl, data); // n3.Writer Turtle
const parsed = await bookmark.parseDocument(resourceUrl, body, contentType); // via @jeswr/fetch-rdf
const w = new bookmark.Wrapper(bookmark.subject(resourceUrl), store, DataFactory);
```

## Ordered collection rules

The generator accepts `fields.instructions.ordered = { position: "http://schema.org/position",
value: "http://schema.org/text" }` for a property referencing an item NodeShape. Its
manifest projection is:

```json
{
  "name": "instructions",
  "predicate": "http://schema.org/recipeInstructions",
  "kind": "literal",
  "datatype": "http://www.w3.org/2001/XMLSchema#string",
  "collection": "ordered",
  "ordered": {
    "itemClass": "http://schema.org/HowToStep",
    "position": "http://schema.org/position",
    "value": "http://schema.org/text",
    "minPosition": 1,
    "severity": "Violation"
  }
}
```

```ts
const store = recipe.build(resourceUrl, { instructions: ["Boil water", "Add pasta", "Add pasta"] });
const wrapper = new recipe.Wrapper(recipe.subject(resourceUrl), store, DataFactory);
wrapper.instructions = ["New first step", "New second step"];
// Getter: readonly string[] snapshot; assigning replaces. Local array mutation is not persisted.

// The getter returns undefined for an absent AND for a present-but-invalid field, so the
// setter refuses (TypeError) to replace links that fail validation: a snapshot edit such as
// `w.instructions = [...(w.instructions ?? []), "Serve"]` after an untrusted append would
// otherwise delete every valid item. Discard invalid data only explicitly:
resetOrderedField(wrapper, "instructions", ["Serve"]); // values default to [] (clear)
```

| Contract | Behavior |
|---|---|
| Item admission | Same lexical document, safe absolute http(s) NamedNode, distinct from the document and owner subjects; blank/literal/foreign/unsafe links fail. Require the item class through actual data-graph types/subclasses. |
| Position | Exactly one `xsd:integer` term, validated by the existing integer mapper (safe-integer precision cap); apply optional `minPosition`. Numeric ascending order, gaps allowed, duplicate positions invalid even for equal values. Negative integers are allowed without a restricting lower bound. |
| Value | Exactly one term, read/written with the same datatype, enum, IRI scheme, pattern, length, range and text sanitization rules as scalar fields. Duplicate values survive. No new string-size or lexical policy is invented. |
| Failure grading | Any invalid item, duplicate position or outer cardinality failure rejects at Violation severity (even on a present optional field); Warning/Info omit the whole field. `requiredFailClosed` still enforces absence. Strict `sh:node` children retain their all-constraints policy. |
| Bounds | `MAX_ORDERED_ITEMS = 256` per field, plus 10,000 shared raw link/position/value/class reads per ordered read. Existing shared migration budgets also apply. Reads fail closed; oversized/nonarray writes and surviving item counts outside outer `sh:minCount`/`sh:maxCount` throw `TypeError` before mutation, at every severity. Ordered `minCount`/`maxCount` above 256 fail manifest validation. |
| Write identity | `<document>#<resolvedFieldName>-<n>`, where n is a positive decimal integer without leading zeros; occupied unrelated/shared IRIs, and cleaned-up item IRIs that still carry any other triple, are skipped and the item class is asserted. Invalid scalar writes drop members just as other collection writes do; surviving positions are consecutive. |
| Replacement | Clear owner links; remove only matching item class, position and value triples from safe same-document nodes explicitly typed with the item class, matching exactly `#<resolvedFieldName>-<n>` (positive decimal n without leading zeros), distinct from document/owner subjects, and exclusively referenced by that owner/field. Preserve every other node's triples, unrelated predicates/types, and shared/foreign data; preserved triples stay on their old node, whose IRI is not reused for a new member. |
| Accessors/migration | Fresh array snapshots with a replacing setter; `undefined`/empty arrays clear when the minimum permits. When owner links are present but fail validation, every setter assignment (including `undefined`/`[]`) throws `TypeError` before mutation; `resetOrderedField(wrapper, name, values = [])` is the only explicit discard (same array/cap/outer-cardinality checks, the same staged write-constraint validation as the setter, and it stays usable past the 256-link stored cap). Arrays preserve order and multiplicity during migration preservation checks. Composite and generated node views share the same implementation. |

Manifest validation rejects missing/unknown descriptor keys, unsafe or overlapping predicate
IRIs, invalid severity or unwritable position bounds, outer counts above `MAX_ORDERED_ITEMS`, item classes owned as migration aliases,
and scalar defaults, aliases or set policies on ordered fields. The generator's closed item
profile requires exactly position + one value property, each with minCount/maxCount 1.
It emits explicit item-class and IRI node-kind SHACL constraints because targetClass alone
does not constrain a linked item. See federation-codegen's ordered admission table.

## Rules

- Never hand-write a manifest for production use. Manifests come from `federation-codegen`,
  whose fidelity assertion proves every field traces to `shapes.ttl` or the committed config.
- Keep generated artifacts data-only. A manifest must never carry code, regex source,
  templates or path expressions; `validateManifest` rejects unknown keys and enforces caps.
- All emission goes through `src/rdf.ts`'s `serializeTurtle`, after alias migration.
  Immediately before `n3.Writer`, reject unsafe NamedNodes in subject, predicate,
  object and graph positions, literal datatype IRIs, prefix namespaces, and prefix
  labels outside Turtle `PN_PREFIX` (the empty default prefix is allowed).
  Recheck mutable manifests; never escape or canonicalize an unsafe identity.
  Reject unsupported term kinds (including Variable/Quad), invalid RDF positions,
  invalid Turtle blank-node labels and malformed BCP 47 language tags. Re-parse
  buffered output and check the same quad set, including literal identity and a
  known blank-node bijection, before returning it; failure throws `TypeError`.
- Resource URLs and every derived subject pass `isSafeAbsoluteIri` without rewriting
  their lexical identity. `subject`, `build`, `serialize`, and direct `Wrapper`
  construction throw `TypeError` on an unsafe or relative IRI; `parse` and
  `parseDocument` return `undefined` (before parsing an unsafe document base).
  Wrappers accept strings or safe absolute NamedNodes; other term kinds throw `TypeError`.
  `storeToTurtle` also throws `TypeError` for unsafe NamedNodes and datatype IRIs
  anywhere in the emitted graph. Public `types.add` rejects unsafe IRIs before insertion.
  The exported `subjectIri(resourceUrl, fragment?)` validates both the resource and
  the minted subject; flat, composite, and generated per-node handles use it.
  Reject instead of escaping: `rdf-serialize`'s `escapeIri` percent-encodes forbidden
  characters and changes identity, while `n3.Writer` does not validate IRIREF safety.
- Every IRI field with `iriScheme: "http-https"` or `iriScheme: "https"` goes through `httpIriOrUndefined` on read
  and write. On reads, first validate SHACL constraints on the original RDF term's exact
  lexical spelling; normalization only projects an already-admitted value. IRI enum members
  retain their exact identity on reads and writes; the scheme filter checks but never
  rewrites them. Do not widen schemes without a new reviewed guard.
- A Violation-graded MUST (`requiredFailClosed`) rejects the whole record on parse when
  missing, malformed, ambiguous, or outside its set cardinality bounds. At the root,
  optional fields drop and optional sets retain valid members. Nested validation checks all
  present values before projection. Required sets also reject any invalid raw member.
- build does not enforce requiredFailClosed: missing or invalid values are dropped and a
  typed shell may be returned. This preserves the bookmark facade's write contract. Parse
  the built store and require a defined result before publishing it if MUST validation is needed.
  Ordered fields enforce their outer minimum/maximum on the surviving item count and throw
  before mutation when those bounds fail, including omitted fields below their minimum.
- Closed `in` enums are enforced on reads, build, setters and live-set adds. Invalid enum
  values drop, consistently with other invalid writes; they do not throw.
  Reads compare raw literal lexical forms and datatypes against canonical enum
  terms before mapping to JS values. Decimal/integer readers reject precision loss
  by comparing canonical decimal spellings before/after JS number conversion.
  String-subtype lexical validators run on raw values on reads and writes; never
  sanitize an invalid lexical form into a valid one.
- Ontology-derived concept enums use the same exact RDF membership path with
  `guards.iriEnum: true`. This marker requires an IRI field with a nonempty, distinct,
  capped `in` list of safe absolute IRIs. False/nonboolean markers, nested/literal
  fields, trim/dropBlank policies and defaults outside the enum fail manifest validation.
  Supplied nonmember or nonstring values throw the existing `TypeError` on build,
  setters and live-set adds; reject before alias migration or normalization.
  Set builds require arrays; duplicate valid members deduplicate. `undefined` clears
  a singleton or omits a build field, but is invalid as a supplied set member.
  Reads drop nonmember IRIs, literals and blank nodes; required failures reject the
  record. Concepts need no `rdf:type` triples in pod data. With `iriScheme`, every
  member must survive the scheme guard (manifest validation), so a member write never
  clears the field silently. The generated `shapes.ttl` lowers `sh:class` to `sh:in`;
  validate pod data for such fields against that file, never the sector SHACL. Ordinary `in` enums keep
  their historical drop-invalid writes.
- Read aliases are optional `aliasTypeIris` on flat entities/composite nodes and ordered
  `aliasPredicates` on flat fields (at most four distinct, Turtle-safe absolute http(s) IRIs per key).
  They exclude canonical IRIs; predicate aliases cannot overlap any canonical/alias
  predicate across the manifest. A canonical predicate shared across owners must have no
  aliases on any owner; co-typing means disjoint focus sets cannot be proved.
  `rdf:type` and structural link predicates are reserved
  from flat fields and all aliases. Type aliases cannot overlap any canonical type or
  another owner's alias. `nested` links reject aliases, including empty arrays.
- Singleton reads guard the canonical value first, then aliases in order; only `undefined`
  falls back (`false`, `0`, and `""` win). Defaults require all predicates to be absent,
  cannot satisfy `requiredFailClosed`, and never apply with `maxCount: 0`.
  Each predicate checks distinct raw terms and maxCount before mapping: ambiguity or a
  cardinality violation drops the field without alias fallback; a required field rejects.
  Sets expose the guarded union; parse checks raw-union maxCount and guarded raw-term-union
  minCount before deduplicating the JS projection. Required sets reject invalid raw members.
  Reads never mutate. Singleton migration preserves the raw term selected by canonical-first
  reads; set serialization and live-set mutations migrate all retained guard-passing raw terms.
  Keep exact lexical forms, datatypes, IRI spellings and raw cardinality, even for terms with
  equal JS projections. Revalidate raw terms, never re-project and rewrite retained values.
  Retained text is not sanitized during migration; explicitly supplied API values still pass
  through JS write guards and sanitization. Setters clear aliases even on `undefined`/invalid
  input; `mark` clears explicit alias types. Serialization migrates aliases in a copy only
  at their owning shape's focus nodes: recognised entity roots (including data-graph
  subclasses) and composite nodes reached through bounded, unambiguous links satisfying
  explicit link classes. Determine all ownership against the original data before any
  mutation. Preserve unrelated subjects and unreached composite nodes, including their
  alias predicates/types. Preserve subclass type assertions and never add target types
  to untyped children during migration.
- After serialization migration, re-parse every previously recognised entity and node
  projection, including unreached typed nodes and reached untyped child focuses. Require
  identical recognition and parsed results; throw exported `MigrationError` before emission
  on any change, including an invalid-record repair or a newly exposed default. Bound all
  candidate scans, class walks and re-parse reads/visits with a shared 10,000 budget; exhaustion
  throws the same typed error.
- Every write path (build, singleton setters, live-set add/delete/clear, `mark()`,
  `storeToTurtle`, `serialize`) runs the SAME checked migration on a copy BEFORE the explicit
  change; on `MigrationError` the live dataset is unchanged. There is no unchecked fast path.
  Generated per-node views pass the owning manifest as `defineModel(views, { migrationManifest })`
  so their checks see the full model. The primary manifest's own preservation checks always
  still run alongside, so the option can only add context, never drop a check.
- Nested links carry their own `minCount`, independent of root requiredness and severity:
  inside strict `sh:node` validation an absent link below its minimum makes the child fail. Before deleting alias types, materialise satisfied explicit
  link classes on affected subjects, preserving ancestry proofs as builds do.
- Deliberate G5 migration exception (root reads): for singleton `sh:alternativePath` fields, SHACL
  counts the union for `maxCount`, but runtime reads resolve canonical-first. A stale
  conflicting alias beside a valid canonical value can therefore parse even when the
  emitted SHACL rejects that union's cardinality. This preserves the reviewed bookmark
  oracle. Writes are canonical-only and clear aliases, so the runtime never produces
  that conflicting data at the migrated field's focus nodes.
- Composite entities graph-walk exact link terms from the root; never assume fragments.
  Count distinct raw object terms of every kind before filtering NamedNodes; more
  than one rejects a required link's record or drops an optional link's whole subtree.
  A linked NamedNode must be an absolute http(s) IRI without IRIREF-forbidden characters.
  Follow that exact term without URL canonicalisation; an unsafe required link rejects
  the record and an optional link drops its subtree.
- Retain a composite link's `sh:class` as `hasClass`. Check the linked subject's actual
  `rdf:type` values and `rdfs:subClassOf*` chains in the data graph, never the build-time
  ontology. Bound traversal to 10,000 raw reads per link and track visited class terms;
  absence, cycles without membership, and budget exhaustion fail the link closed with its
  required/optional grading. Node-type recognition (flat entities, composite roots,
  and per-node wrappers) uses the same bounded walk to any canonical or alias target class,
  with one 10,000 raw-read budget across the accepted classes. Never add or delete subclass
  `rdf:type` assertions during recognition or serialization; `mark` retains its existing
  explicit alias-to-canonical type migration. Builds assert the explicit link class on
  materialised children. For composite children, validate the property constraints without
  requiring the child shape's target type: `sh:targetClass` selects focus nodes,
  while `sh:node` applies the child constraints directly. Every present child value must
  satisfy its property constraints, even optional fields or deeper optional links. Absent
  values obey the property's minimum. Check the raw path union for nested conformance before
  canonical-first projection. A failed child rejects a required incoming link or drops an
  optional root link's subtree. Root field parsing retains its drop-invalid-optional policy.
  Explicit `hasClass` still applies. `classOnly: true` records `sh:class` without `sh:node`;
  require `hasClass` to equal the child's sole canonical target class exactly. The strict
  every-present-value rule applies to `sh:node` children only. A class-only child is its own
  class-targeted focus node, so it parses with the root policy: its optional failures
  (ambiguous optional links, malformed optional values) drop only that field, and only its
  required fail-closed constraints reject it.
  Reject a link whose `hasClass` names a type alias owned by ANY entity or node in the
  manifest, including optional links: type migration can delete that assertion.
- Domain policy the schema cannot express (network fetches, SSRF policy, reconciliation)
  belongs in the consuming package's facade, not in this runtime.
- Changes here are security-critical: add an adversarial test that fails before the fix.

## Exports

`defineModel`, `validateManifest`, `ManifestError`, `MigrationError`, `MANIFEST_VERSION`, `RUNTIME_MAJOR`,
manifest types, and the shared guards `httpIriOrUndefined`, `isHttpIri`, `sanitizeText`,
`tryRead`, `isSafeAbsoluteIri`, `isTurtlePrefixName`, `subjectIri`, the strict RDF/JS `readLiteral` reader, plus the XSD datatype
mappers. Packages migrating off hand-written models may reuse the guards so their filter
behaviour stays byte-identical.


## Fixed values and entity invariants

A scalar field may carry `hasValue: { term, severity }`, where `term` is
`{ kind: "iri", value }` or `{ kind: "literal", value, datatype }`. Literals retain
canonical lexical spelling and their exact datatype. Reads compare the selected,
guarded RDF term, so `"1"^^xsd:boolean` does not satisfy a `true` constant. Missing,
ambiguous or different values reject at Violation grade; Warning/Info omit the field,
following the existing advisory policy. Defaults cannot supply a fixed value.
Builds and setters require the exact term at every severity and throw `TypeError`
before changing a live dataset.

An entity or composite node may carry `invariants`, each with its source `shape` IRI,
`severity`, optional `message`, and a data-only `expression`. Operators are `hasValue`
(`path`, `term`), `not` (`expression`), `and`/`or` (`expressions`), and `qualified`
(`path`, `targetClass`, `minCount`, `expression`). Paths identify one field on the current
entity, and that field may not carry read aliases. A qualified expression changes context to
its linked entity; its path is a composite link or an IRI set, and `targetClass` names the
entity whose fields the inner paths use.

Atoms are evaluated with SHACL semantics over the RAW data graph, not over parsed values.
`hasValue` holds iff the exact term is among the focus node's raw objects of the path
predicate; nothing is dropped by maxCount, datatype, guards or ambiguity. `qualified` counts
the distinct raw objects of the path (IRIs of any scheme, blank nodes, literals) on whose own
raw data the inner expression holds; the linked node need not be typed or pass its own
reader, and its own invariants do not decide whether it counts. Why: invariants are mostly
negated safety rules (`not (risk = absent and a present risk marker)`). Evaluated over
validated values, a value the reader drops would make an atom false and the negation true,
so the rule would fail open. Raw evaluation makes the runtime agree with an external SHACL
validator of the emitted shapes.ttl and fail closed. Read defaults never invent RDF presence.

A false Violation invariant rejects a parse. Warning/Info invariants are advisory: the
runtime has no diagnostic callback, so it does not evaluate them (they can neither reject
an entity nor exhaust a budget, on reads or writes); their messages remain in the manifest
and SHACL.

In a composite, a child's Violation invariants and Violation-graded fixed values bind its
parent however the link is graded; its other constraints do not (see below).
Whenever the link has a raw object, the containing parse rejects if any value node of the
link fails a Violation invariant of the child node, or lacks the exact term of a
Violation-graded fixed value among the raw objects of that field's predicate (or a read alias).
This applies recursively through nested descendants. An `sh:node` link checks every value
node: any IRI scheme, blank nodes, literals, and values an ambiguous link would drop. A
class-only (`sh:class`) link checks only the value nodes that are instances of the link
class or the child's type IRIs, since only those are SHACL focuses of the child. Behind an
optional link, every other child failure still drops the child, as before. This covers
malformed or ambiguous values, a missing required field, advisory constraints, and a
present fixed value made ambiguous by a second value, and a child failing `sh:in`, a datatype
or a cardinality constraint, even though an external SHACL validator rejects the parent for
those. Advisory invariants stay unevaluated even behind `sh:node`, where real SHACL reports
a failing nested Warning as a Violation of the parent. Whether optional links should keep
dropping such children is an open maintainer decision (tracker, needs:jesse). A required
link still rejects on any child failure. Why: an optional link must not hide a child that an external SHACL validator
of the emitted shapes.ttl rejects; the probe is a child carrying
`not(hasValue(flag, true))` whose data says `flag true`.

Invariants see only the parsed dataset. A qualified atom whose linked node lives in another
document (for example a `self`-subject entity stored in its own resource) sees no triples for
it, so the atom is false and a negated rule passes vacuously, exactly as SHACL over that
single graph would. When a rule spans resources, merge the linked documents into the dataset
before parsing.

Writes are validated in a model whose manifest (or a `checkAlso` manifest) has a Violation
invariant or a fixed value at any severity; advisory invariants alone keep the ordinary
write path. Every build validates its completed state. Setters (including ordered-field
setters), field/type live-set add/delete/clear, and `mark()` stage the write in a copy
(with the same alias migration a write runs without invariants; type-set writes migrate
nothing, as before), validate it, then apply the delta; failure leaves the dataset
unchanged. Validation covers only focuses the write can affect, so an invalid unrelated
sibling never blocks a write: the written node under the writing shape, and every named
node the write changes (including the item nodes an ordered write rewrites) under every
shape it is a focus of (typed, or reached from a typed composite root); the `sh:node`
descendants of those focuses; and owners whose qualified invariants reach a written node,
found by a bounded reverse lookup along each qualified path chain.
Each must keep its fixed values and Violation invariants. Chained set mutations and
`forEach` callbacks retain the checks; generated node lenses use the full owning model.

Closed validation caps logical depth at four, atoms at sixteen per source shape, and
qualified minima at positive integers up to sixteen. Qualified context changes do not
add a logical nesting level; their inner logical operators do. Evaluation reads each
(node, predicate) once and evaluates each (node, sub-expression) once, so work is linear in
the linked nodes reached. One parse (or one write's validation) may read 10,000 raw quads
for invariants and take 100,000 expression steps. On reads, only entities with Violation
invariants, and composite nodes whose nested children carry Violation invariants or fixed
values, consume this budget. On writes in a validated model, finding the affected nodes
(the written nodes, nested nodes and reverse-linked owners) also draws on it, so a write
to a node with many incoming links can throw the budget error even when that node has no
invariants of its own. Exhaustion rejects the read, including under negation; writes throw
before mutation. Alias-migration audits compare field projections only and keep their own
budget. Ordinary models without these constraints retain their existing build contract.
Generated TypeScript keeps the base scalar/enum type rather
than narrowing a fixed value; runtime checks remain authoritative.
