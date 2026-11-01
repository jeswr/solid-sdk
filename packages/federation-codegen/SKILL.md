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
(`--update-lock` accepts a reviewed input change).

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
- SHACL admission is closed: unsupported property/node constraint components and unknown
  patterns are errors. Supported patterns are exactly `^https?://`, `^https://`, and `\S`
  for string-valued nonblank fields. Advisory flat class hints may only be omitted with
  a warning, because they cannot weaken a Violation MUST. Composite link targets must satisfy
  their class (explicit ontology subclass ancestry allowed) and referenced node shape.
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
  Runtime structural predicates are reserved; type aliases cannot overlap any canonical
  type or an alias owned by another entity/node.
  Both keys are optional, read-only, and capped at four distinct absolute http(s) aliases
  by the runtime. Fidelity covers both keys exactly in both directions, including order.
- Composite nodes and derived views support aliases on types/flat fields. Structural
  `nested` links explicitly reject aliases; an aliased shape field cannot be omitted.
- `parseShapes` needs the adapter's normalized ontology as its third argument for aliases;
  its fourth argument carries raw ontology quads for composite subclass ancestry checks.
  `generateModel` supplies both (legacy third-argument quads use the OWL/RDFS adapter).
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
