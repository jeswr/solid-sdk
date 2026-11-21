---
name: federation-codegen
description: Use when generating a typed domain model from a sector ontology plus SHACL profile, writing a codegen.config.json, running admission or the fidelity assertion, migrating a hand-written model package to generated code, or changing @jeswr/federation-codegen.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Domain-model code generation

`@jeswr/federation-codegen` lives in `packages/federation-codegen`. It compiles an OWL/RDFS
ontology, its SHACL profile and a per-domain `codegen.config.json` into:

| Artifact | Contents |
|---|---|
| `model.d.ts` | Types only. |
| `model.json` | The shape-manifest, fidelity-asserted against `shapes.ttl`. |
| `model.js` | Fixed-template shim over `@jeswr/model-runtime`; bytes vary only in inlined JSON. |
| `shapes.ttl` | Byte-reproducible SHACL: shape/list nodes skolemized, complex-path roots deterministically labelled blank nodes. |
| `codegen.lock.json` | Input/output hashes; regeneration fails closed on input drift. |

```ts
import { emitLockfile, generateModel } from "@jeswr/federation-codegen";

const result = generateModel({ ontologyTtl, shapesTtl, config });
// result.artifacts: { "model.d.ts", "model.json", "model.js", "shapes.ttl", "codegen-manifest.json" }
```

CLI: `federation-codegen gen --ontology <ttl> --shapes <ttl> --config <json> --out <dir>`
(`--update-lock` accepts a reviewed input change). `gen` passes an existing
`<out>/model.json` to `generateModel` as `previousManifest`, which pins concept-enum
strictness across regenerations.

A workspace package that commits generated output must pass the root `check:codegen` guard.
It needs a `codegen` script writing to `src/generated`, a `workspace:*` devDependency on this
package, and a drift test running `pnpm run codegen --out <tmp>` with a byte comparison.
`packages/solid-bookmark` (`package.json`, `test/codegen.test.ts`) is the reference.

## Rules

- Admission (tier a) must pass: every class/property labelled and defined, domain/range or a
  waiver, every literal datatyped, every class covered by a NodeShape. Do not pass
  `--allow-unadmitted` in committed generation scripts.
- Requiredness comes from SHACL severity (G1): only `sh:Violation` `minCount >= 1` is
  fail-closed. SHOULD constraints are `sh:Warning`. Config cannot disable a MUST.
  A present `sh:severity` must have exactly one value; duplicate declarations fail
  admission before any value-only projection, regardless of order.
- Reject multiple property shapes sharing a path within one NodeShape, including
  canonical/alternativePath-member overlaps, in either order. Do not conjoin them
  or overwrite one shape's constraints with another's.
- Multiple NodeShapes with the same canonical target class and identical target alias
  sets form one entity under its class config. Merge in shape-IRI order; conjoin matching
  paths only under one unambiguous entity config. Competing flat configs, or flat and
  composite claims to the same class, reject before compilation; never first-pick a config.
  Merge paths by intersecting cardinalities, numeric bounds and enums and taking the greatest
  minimum length. Different explicit datatype, class, nodeKind, node, name or pattern,
  incompatible alternative paths, and empty intersections fail with both source shapes
  named. A source `sh:in` is decoded with that source's value kind, so the merge rejects
  any source enum whose kind or datatype differs from the conjoined field (an implicit-IRI
  `sh:in` merged with an `xsd:string` or `sh:Literal` source); never re-decode or
  intersect IRIs and literals by JS value. Fidelity re-checks every merged property
  against each source shape (kind, datatype, class, node, pattern, bounds, enum subset),
  not only against the merged constraint. Preserve original property severities/messages in SHACL; presence is a MUST
  only if a source property requires presence at Violation grade. Inspect every original
  graph constraint: a second safety shape containing `sh:not` still rejects the entity.
  A shared anonymous property shape keeps one skolem identity within its class group;
  reusing it across different classes retains the identity-collision rejection.
- A `sh:class C` property becomes a closed concept IRI enum when the ontology contains
  direct named `rdf:type C` individuals and C is not a shape target, target alias or
  configured entity/node target. Ignore blank individuals and inferred subclasses.
  Explicit `sh:node` and configured composite links retain link semantics. Zero named
  individuals retain the existing class behavior. A reusable property shape used as a
  link by any owner is never lowered for another owner.
  Only used concept classes gain the
  NodeShape-coverage exemption; their labels/definitions remain mandatory.
  Compile sorted exact identities into `in` plus `guards.iriEnum: true`, intersecting
  explicit `sh:in`. Fidelity checks both membership and the strict-write marker.
  Emit a literal-union TS type and lower those class constraints to closed `sh:in`
  lists in emitted SHACL; never require concept `rdf:type` assertions in pod data.
  Invalid supplied concept writes throw the existing `TypeError`; reads retain normal
  severity-graded drops. Ordinary `sh:in` writes retain their drop-invalid contract.
  A Warning-graded concept `sh:class` still becomes a strict runtime enum: supplied
  nonmember writes throw and reads drop nonmembers. Emitted `sh:in` retains
  `sh:Warning`, so runtime membership enforcement is stricter than the advisory SHACL.
  Strictness must never flip silently: an advisory `sh:class` on a projected class
  with named individuals fails (`unstable-concept-enum`), and the CLI passes the
  committed `model.json` as `previousManifest` so a field that was an `iriEnum` and
  would become unenforced fails generation. Remove the committed `model.json` to
  accept such a loosening deliberately.
  A concept member that the property's `^https?://` / `^https://` pattern (or the
  derived scheme guard) excludes fails generation (`concept-enum-scheme-conflict`);
  an explicit `sh:in` may intersect it away.
  Lowering makes emitted `shapes.ttl` diverge from the sector profile in both
  directions (no pod `rdf:type C` required; typed non-individuals and subclass
  instances excluded). Consumers MUST validate against the emitted `shapes.ttl`,
  never the sector SHACL, for concept-lowered fields.
- Prefix names must match Turtle `PN_PREFIX` (including the empty default prefix).
  Config loading rejects an unsafe or relative `shapesBase`. Every Turtle/N-Triples
  emission goes through `serializeCanonicalTurtle`, checking all NamedNodes,
  literal datatypes, prefix names and namespace IRIs immediately before `n3.Writer`.
  The shared runtime validators also check term kinds/positions, Turtle blank-node
  labels and BCP 47 language tags. Re-parse buffered output and verify the same
  quad set with a known blank-node bijection before returning it; fail with `TypeError`.
  Generated per-node `subject()` handles call
  runtime `subjectIri`, rejecting unsafe resources with `TypeError` and preserving
  exact lexical identity for safe resources and derived fragment IRIs.
- Shape-derived `iriPattern` checks the original RDF lexical spelling before URL
  normalization (`"https"` for `^https://`, `"http-https"` for `^https?://`). The
  separate `iriScheme` guard applies scheme policy and normalization. Fidelity
  requires both guards for these patterns. `sh:minLength` derives only `minLength`;
  `nonBlank` requires the supported `\\S` pattern or explicit field config policy.
  All admitted shape-derived read constraints, including length and enum membership, run
  against original RDF terms before JS projection. IRI enums preserve exact identities on
  reads and writes; scheme policy filters them without rewriting. Set minimum cardinality
  counts distinct guarded raw terms before JS deduplication; required sets reject invalid terms.
- Reject shapes that are SHACL instances of `rdfs:Class` or `owl:Class` in the shapes graph
  (rdf:type then a bounded, cycle-safe rdfs:subClassOf* walk): implicit class targets have no
  exact runtime projection. The ontology graph is not consulted, as in SHACL. Normalization,
  admission, compilation and fidelity fail closed.
- A nested link's `sh:minCount` is emitted on the link and fidelity-checked independently of
  severity-graded requiredness.
- A composite's flat `*Data` type marks a child node's required fields required only when
  every link on the path from the root is required, because parse returns such an object
  without an optional child that is absent or invalid. The flat type does not stop a
  caller from filling an optional child only partly; build then writes a non-conforming
  child (tracked as sst-ild.4.14), so facades must supply all or none of its MUST fields.
- SHACL admission is closed: unsupported property/node constraint components and unknown
  patterns are errors. Supported patterns are exactly `^https?://`, `^https://`, and `\S`
  for string-valued nonblank fields. At the root, advisory flat class hints may only be
  omitted with a warning, because they cannot weaken a Violation MUST. Composite link targets must satisfy
  their class (explicit ontology subclass ancestry allowed when `sh:node` is present) and
  referenced node shape. A class-only link may project only a shape targeting that exact
  class, never a subclass. Emit `classOnly: true` so runtime manifest validation independently
  checks exact equality with `hasClass`; fidelity verifies this source distinction.
  Reject projecting a child shape from a bare IRI link with neither `sh:class` nor `sh:node`.
  Inline or unprojected `sh:node` values are admission errors. Every projected parameter
  retains strict RDF term-kind, datatype and lexical validation; enum literals use the
  runtime's `readLiteral` reader.
  Admission rejects every `sh:datatype` outside model-runtime's exported immutable
  `VALIDATED_DATATYPES` inventory; there is no opaque-string fallback.
  For composite `sh:class` links, retain the class as `hasClass` and fidelity-check it
  exactly. Canonical target compatibility remains a structural mapping check; generation
  never treats ontology ancestry as proof for an alias. At runtime require class membership
  through the linked subject's actual `rdf:type` and `rdfs:subClassOf*` in the data graph.
  Aliases may supply that ancestry in the data alone. Builds assert the explicit link class
  on materialised children; runtime traversal is cycle-safe, bounded and fails closed.
  Compilation, fidelity and runtime manifest validation must independently reject `sh:class`
  naming a type alias owned by ANY entity or node in the manifest, including optional links:
  type migration can delete that assertion. Runtime root recognition also accepts canonical/alias
  target classes through data-graph `rdfs:subClassOf*`, using the same 10,000 raw-read budget
  across accepted classes; writes preserve the subject's subclass type assertions.
  A composite child's `sh:node` validation checks property constraints without requiring
  its shape's target type. `sh:targetClass` selects focus nodes; it does not constrain a value
  reached through `sh:node`. Every present child value must satisfy its constraints,
  including optional fields and deeper optional links; absent values obey the property's
  minimum. Nested validation checks the raw path union before canonical-first projection.
  Reject omitted child properties in compilation and fidelity, including optional constraints;
  advisory flat class hints inside children require modeled composite links. Root parsing
  keeps its documented optional-field drops. Explicit link `sh:class` is still enforced;
  builds may assert canonical child types.
  Decimal/integer bounds and enums must preserve canonical decimal spelling through
  JS number conversion. Reject noncanonical literal enum members that the runtime
  writer cannot reproduce exactly; value-only projection must not broaden `sh:in`.
- Config may add guards (defaults, trims, sort, http(s) scheme) but never contradict the
  shape; the fidelity assertion fails if a required guard is missing or disagrees with SHACL.
  Config defaults on Violation `minCount >= 1` fields are rejected.
  Compilation and fidelity independently reject IRI properties carrying `sh:datatype`
  and every impossible `minCount > maxCount`, before projecting fields or nested links.
- Aliases come only from SHACL: multiple `sh:targetClass` values select the unique explicit
  ontology `owl:Class` as canonical and emit the sorted extras as `aliasTypeIris`; a flat
  2–4 IRI `sh:alternativePath` list selects the unique ontology property as canonical and
  emits its other members, in list order, as `aliasPredicates`. Ambiguity, malformed/nested
  paths, and aliases overlapping any other canonical/alias field predicate fail admission.
  If owners share a canonical predicate and any owner declares aliases for it, reject the
  profile and manifest: RDF co-typing prevents proving their focus sets disjoint.
  Runtime structural predicates are reserved; type aliases cannot overlap any canonical
  type or an alias owned by another entity/node.
  Both keys are optional, read-only, and capped at four distinct absolute http(s) aliases
  by the runtime. Fidelity covers both keys exactly in both directions, including order.
  Runtime migration applies only at the owning shape's focus nodes: recognised entity roots
  (including data-graph subclasses) and children reached through bounded, unambiguous composite
  links satisfying explicit link classes. Establish ownership from the original data before
  changing predicates/types. Unrelated subjects and unreached composite nodes retain their
  predicates/types, including aliases. Runtime migration keeps retained raw term identities
  and cardinality for singleton fields, sets and live-set mutations;
  normalization/deduplication belongs to the JS read projection,
  not migration. Singleton migration retains canonical-first selection. Only explicit API
  values pass through JS write normalization and text sanitization.
- Before deleting alias types, migration materialises satisfied explicit link classes on
  affected subjects. Then require identical recognition and parsed results under all previously
  recognised entity/node shapes (even unreached typed nodes) and reached child focuses.
  Runtime `MigrationError` prevents emission on a change or shared 10,000-read/visit budget
  exhaustion. Include regressions for type-recognition loss and changed parsed values.
- Composite nodes and derived views support aliases on types/flat fields. Structural
  `nested` links explicitly reject aliases; an aliased shape field cannot be omitted.
- `parseShapes` needs the adapter's normalized ontology as its third argument for aliases;
  its fourth argument carries raw ontology quads for composite subclass ancestry and
  concept individuals. An optional fifth config argument identifies projected targets
  and composite links before concept-enum selection. Resolve that selection after
  merging properties, since another shape can supply the link's name or `sh:node`.
  `generateModel` supplies all three (legacy third-argument quads use the OWL/RDFS adapter).
  Preserve complex-path roots as blank nodes with deterministic
  labels: skolemizing a path root silently changes its SHACL meaning to a predicate.
- Mint skolem IRIs from full shape/class/path identities using stable hashes and
  readable suffixes. Check every minted identity against all named IRIs in the
  input profile and other minted identities; collisions fail closed.
- `skos:closeMatch`/`exactMatch` are not substitutions and NEVER create aliases.
- Consumers keep a hand-written facade (target 150 lines or fewer) that maps the generated
  entity onto their public API. The parity bar is the package's existing tests run verbatim
  against the facade (the oracle method).
- Commit generated output and test that a fresh generation is byte-identical.
- RDF discipline holds: parse with n3/fetch-rdf, serialise with n3.Writer, no LDO.

The design of record is `decisions/0003-domain-model-codegen.md`.

The bookmarks example points to `packages/solid-bookmark`, which owns its normative
`bookmark.ttl` + `bookmark.shacl.ttl`, config, `src/generated/`, and facade. Its 78-test
oracle remains verbatim except imports in the generator integration harness. The harness
validates generated SHACL as well as the package's normative-shape oracle. Do not restore
duplicate config or generated files under `examples/bookmark/`. After a generator change,
build the generator and run `pnpm --filter @jeswr/solid-bookmark run codegen`.
