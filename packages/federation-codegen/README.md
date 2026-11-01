<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 4.8 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/federation-codegen

> **Experimental, AI-agent-generated.** Lives in `packages/federation-codegen` of the
> [`jeswr/solid-sdk`](https://github.com/jeswr/solid-sdk) workspace; the standalone
> `jeswr/federation-codegen` repository becomes a read-only build mirror. Design of record:
> [`decisions/0003-domain-model-codegen.md`](../../decisions/0003-domain-model-codegen.md).

> Ontology-driven data-model codegen for the Solid app suite (design rev-3 **P0**). It
> deterministically compiles a **sector ontology (OWL/RDFS)** + its **SHACL profile** + a per-domain
> **codegen config** into a typed data model whose behaviour lives entirely in the audited
> [`@jeswr/model-runtime`](https://github.com/jeswr/model-runtime).

**Status:** alpha — P0. Generated artifacts carry **no model-specific executable logic** — all
behaviour is in the runtime, audited once (the `model.js` shim is a fixed template whose bytes vary
only in the inlined JSON).

## What it generates

For each `sh:NodeShape` in a domain's SHACL profile:

| Artifact | What it is |
|---|---|
| `model.d.ts` | Types only — precise `Data` / `Wrapper` / `Entity` interfaces. Zero runtime code. |
| `model.json` | The compiled shape-manifest — a **fidelity-asserted verified projection of `shapes.ttl`**, never a bespoke schema (§7.2). |
| `model.js` | A **fixed-template shim** — imports `@jeswr/model-runtime`, inlines the manifest, calls `defineModel`. Bytes vary only in the JSON. For a composite it also inlines the derived per-node view manifest + index and exports `nodes` (see below). |
| `shapes.ttl` | The **byte-reproducible** SHACL shape (shape/list nodes skolemized; complex-path roots retain deterministic blank labels) — the stable waist (§5). |
| `codegen-manifest.json` / `codegen.lock.json` | Input/output sha256s + adapter + runtime pins; the Mode-A lockfile (fail-closed on input drift). |

## Pipeline

```
ontology (OWL/RDFS) + SHACL profile + codegen config
  └─[L0] ontology-input adapter (swappable seam; V1 = owl-rdfs-v1)
  └─[L1] tier-a admission (fail-closed): labels+definitions, domain/range-or-waiver, SHACL coverage
  └─[L2] parse + normalize the SHACL profile → shapes.ttl (byte-reproducible)
  └─     compile manifest (shape-derived + config-supplied guards)
  └─     FIDELITY ASSERTION (P0 exit) — model.json ↔ shapes.ttl, order-independent, fails on mismatch
  └─     emit model.d.ts / model.json / model.js
```

- **Admission (tier-a)** refuses to generate from an ontology/profile that would produce a
  silently-incomplete model (missing labels, un-domained/ranged properties, a literal without a
  datatype, a class without a NodeShape). SHACL components are allowlisted: direct property paths,
  datatype/IRI term kinds, cardinality, enums, numeric bounds, string minimum length, and composite
  `sh:class`/`sh:node` links. Only `^https?://`, `^https://` (emits `iriScheme: "https"`), and
  the nonblank string pattern `\S` have reviewed closed guards; other patterns and components
  are admission errors, including on node shapes. Reject implicit class targets: a shape
  that is also an `rdfs:Class` or `owl:Class` has no exact runtime projection. At the root,
  flat Warning/Info class hints may be omitted with a reported warning: they cannot turn a MUST violation into an accepted record.
  Inline or unprojected `sh:node` references are admission errors.
  Decimal/integer bounds and enum members must round-trip through a JS number with
  identical canonical decimal spelling; precision loss fails admission. Literal enum
  members must also equal the runtime writer's canonical RDF term, because the manifest
  stores values and cannot preserve noncanonical spellings such as `"01"^^xsd:integer`.
  `error` violations block; an unbounded-set `missing-cardinality`
  is an advisory `warning`.
- **The fidelity assertion** re-derives an order-independent projection of the merged shapes and
  asserts, field-for-field and constraint-for-constraint, that `model.json` covers it exactly — and
  that every guard flag with no shapes source traces to the committed config. A seeded manifest
  mutation makes it throw (proven in the test suite).
- **Determinism (§5):** `(generator artifact, input bytes) → output bytes`. Double-build + permuted
  input-order byte-equality is tested.

## The bookmarks pilot + the parity bar

[`examples/bookmark/`](./examples/bookmark/README.md) points to the production
[`@jeswr/solid-bookmark`](../solid-bookmark/README.md) package. That package owns the
hand-written ontology + SHACL profile, `codegen.config.json`, generated artifacts, and
public facade. The example re-exports the facade for generator integration tests; no
second config or generated core is kept. **Result: 78/78 of the current solid-bookmark
oracle passes** against the generated model (`test/parity/`). The four oracle copies
remain verbatim except imports; their SHACL tests validate the package's generated
`shapes.ttl` using the workspace RDF engine, complementing the package's unmodified tests
of its normative `bookmark.shacl.ttl`. Generator determinism/fidelity tests read the
package's artifacts directly. The package also tests byte-identical regeneration,
including its lockfile.

`test/generator/sector-divergence.test.ts` documents (honestly) why the fed-vocab **sector** profile
cannot yet drive this generation: it uses `https://jeswr.org/ns/sectors/bookmarks#Bookmark` instead of the package's
`https://jeswr.org/ns/bookmark#Bookmark`, models tags as `bookmark:hasTag`
`skos:Concept` (not `schema:keywords` literals), omits `dct:created`/`dct:modified`, and lacks
the package's URL scheme pattern and legacy aliases. The test reads the actual
workspace sector profile; these are the §4 ratchet gaps the sector must close first.

## Shape-derived read aliases

No config or `skos:closeMatch` / `skos:exactMatch` annotation grants a read alias.

- One NodeShape can have several `sh:targetClass` IRIs when exactly one is explicitly
  declared `owl:Class` in the ontology. It becomes the canonical `typeIris` member; extra
  targets become sorted `aliasTypeIris` (at most four). Zero or several declared OWL
  classes, non-IRI targets, and duplicate canonical shapes fail admission. A single target
  retains the existing OWL/RDFS behavior.
- `sh:path [ sh:alternativePath ( p1 … pn ) ]` accepts 2–4 distinct IRI members when exactly
  one is declared as a property by the ontology adapter. That member becomes `predicate`;
  the remaining members become ordered `aliasPredicates`. Malformed/cyclic lists, blank
  or nested members, all other complex paths, ambiguous ownership, and aliases overlapping
  any other field's canonical or alias predicate fail admission. A canonical predicate shared
  by multiple shape owners cannot carry aliases on any owner: their focus sets may overlap.
- Fidelity compares both alias keys exactly against the normalized shapes in both
  directions, including order. Adding, removing, exchanging, or reordering manifest aliases
  fails the build. Composite nodes and derived node views preserve these keys; aliases on
  structural `nested` links are explicitly rejected, and aliased shape fields cannot be
  omitted from a composite projection.
- The runtime checks alias caps, distinctness, and absolute http(s) IRIs. Singleton reads
  try the guarded canonical predicate before ordered aliases; sets read a guarded union.
  Writes use canonical predicates/types. Store migration removes aliases only at focus
  nodes of their owning shape: recognised entity roots (including data-graph subclasses)
  and children reached through bounded, unambiguous composite links satisfying explicit
  link classes. Ownership is established from the original data before migration; unrelated
  subjects and unreached composite nodes retain their predicates/types, including aliases.
  Migration preserves each retained raw RDF term's lexical form, datatype and IRI spelling,
  including distinct terms
  whose JS projections are equal. Singleton selection stays canonical-first; explicit API
  writes still use the runtime's JS write guards and normalization. Node-type recognition
  accepts data-graph subclasses of canonical or alias classes through the runtime's bounded,
  cycle-safe class walk; it never uses ontology ancestry at runtime or changes subclass types.

Migration materialises explicit link classes before deleting alias types when those types
were proving membership. Its bounded backstop re-parses all previously recognised entity/node
projections and reached children; any changed recognition or parsed result throws runtime
`MigrationError` before emission. It includes unreached typed nodes, and shares a 10,000
read/visit budget across scanning, class walks and re-parsing. The input store is unchanged.

`parseShapes(ttl, shapesBase, ontology?, ontologyQuads?)` uses the adapter's normalized ontology
to resolve aliases and raw ontology quads to check composite subclass ancestry. `generateModel`
supplies both automatically; the legacy third-argument quad form uses the OWL/RDFS adapter.
Shapes stay deterministic
under triple permutation and blank-node relabelling. SHACL complex-path roots **remain blank
nodes with deterministic labels**: turning one into an IRI would change its meaning to a
predicate path and silently lose the constraints. Shape nodes and RDF-list cells are skolemized.
Skolem IRIs hash full shape/class/path identities and retain readable suffixes; collisions
with any existing named IRI or another minted identity fail closed. Config loading validates
`shapesBase`, and the single Turtle/N-Triples writer boundary validates every emitted
term's kind and position, NamedNode, literal datatype, Turtle blank-node label, BCP 47
language tag, prefix label and namespace without rewriting identities. It re-parses the
buffered output and checks the same quad set with a known blank-node bijection in linear
time; a parse error or identity mismatch throws `TypeError` before returning any output.
Hash artifacts intentionally retain hashes of the original input bytes.

## Composite (document-projection) entities

Some domain models are **multi-node**: ONE flat object projected across several connected RDF nodes of
one document (e.g. `@jeswr/solid-listening`'s `ScrobbleData` — a `media:PlaybackEvent #it` → a
`media:Track #track` → `#artist`/`#album`, plus a `time:Instant #playedAt`, with a fail-closed
cross-node MUST: a titled Track + a valid Instant must be reachable). A `kind: "composite"` config
generates a single composite entity over the runtime's composite kind:

```jsonc
{
  "name": "Scrobble", "kind": "composite", "root": "event",
  "nodes": {
    "event": { "targetClass": "…#PlaybackEvent", "fragment": "it",
      "fields": { "msPlayed": {} },
      "links":  { "playedWork": "track", "atTime": "playedAt" } },   // IRI-link props → sub-nodes
    "track": { "targetClass": "…#Track", "fragment": "track",
      "fields": { "title": { "rename": "trackTitle" } } }            // rename → globally-unique key
  }
}
```

- Each node claims its `sh:targetClass`'s NodeShape. A node's `fields` project shape properties as
  FLAT fields (with an optional `rename`, since the composite is ONE flat object — `dct:title` on a
  Track and an Album need distinct names); its `links` project **IRI-link** properties as `nested`
  links to a sub-node (the shape parser reads `sh:class` / `sh:node` / `sh:nodeKind sh:IRI`). The
  target must conform to both `sh:class` and the exact referenced `sh:node` shape. Generation
  checks canonical target compatibility using identity or explicit ontology ancestry when
  `sh:node` is present. A class-only link (`sh:class` without `sh:node`) may project only a
  shape whose canonical target is exactly that class; the manifest records `classOnly: true`,
  which runtime validation checks independently. Compilation and fidelity reject narrower
  subclass mappings. A bare IRI link with neither `sh:class` nor `sh:node` cannot select a
  child shape and is rejected. The generator retains each link's `sh:class` as `hasClass` in the manifest. Fidelity checks it exactly.
  This mapping check never proves a linked subject's class membership: the runtime checks
  its actual types and `rdfs:subClassOf*` chains in the **data graph**, including for aliases.
  Alias ancestry need not be declared in the ontology and ontology-only ancestry cannot
  admit a class violation. Builds assert the explicit link class on materialised children.
  Compilation and fidelity independently reject a link whose `sh:class` names an alias target
  class owned by ANY entity or node in the manifest: type migration can delete that assertion,
  so the configuration is contradictory. Runtime manifest validation independently enforces
  this rule. This rejection also applies to optional links.
  At runtime the root requires a recognised target type. A child reached through `sh:node`
  is validated against its property constraints without requiring its shape's target type:
  `sh:targetClass` selects focus nodes, rather than constraining a `sh:node` value.
  Any explicit `sh:class` remains enforced. Every present value inside a child must satisfy
  its property constraints, including optional fields and deeper optional links. Absence
  obeys the property's minimum. Nested conformance checks the raw path union before
  canonical-first projection; root parsing retains its documented optional-field drops.
  A non-conforming child rejects its required incoming link or drops an optional root link's
  subtree. Builds still assert canonical child types.
  The cross-node MUST (`requiredFailClosed`) derives from a link's Violation-graded `sh:minCount ≥ 1` (G1).
- Compilation and fidelity reject incompatible IRI/datatype constraints and impossible
  `minCount > maxCount` on every property before projection, including nested links.
- The **fidelity assertion** extends to the composite: every projected field traces to a shape
  property; a nested link maps an IRI-link property and a Violation link carries the required guard;
  and **every presence-MUST (`minCount ≥ 1`, Violation) of a node MUST be covered** — a
  security-critical constraint can never be silently dropped from the projection.
- A property that is neither a `field` nor a `link` is omitted (only Warning/Info properties may be —
  a MUST omission fails fidelity) at the root. Every child property must be projected;
  compilation and fidelity reject omitted child constraints, including optional properties.
  Advisory flat class hints inside child shapes also require a modeled composite link.
  A composite claims its node target classes exclusively (they are not also emitted as
  flat entities); each node has a distinct target class; composite documents are
  http(s)-scoped; linked RDF terms must already equal their safe canonical form.

### Composite per-node wrappers (`nodes`)

The composite entity's `Wrapper` is its ROOT node's wrapper. For low-level typed access to the
OTHER nodes (a Track / Artist / Album / Instant subject), the generated model also exports
**`nodes`** — one typed handle per composite sub-node, so a consumer never hand-writes per-node
wrapper classes (this replaced `@jeswr/solid-listening`'s hand-written `src/nodes.ts`):

```ts
import { entities, nodes } from "./generated/model.js";

const track = new nodes.Scrobble.track.Wrapper(
  nodes.Scrobble.track.subject(resourceUrl),   // `${resourceUrl}#track`
  store, DataFactory,
);
track.trackTitle;                              // typed accessor (composite rename applies)
track.performedByArtist;                       // a nested link surfaces as an IRI accessor
```

- Each handle is `{ name, typeIri, fragment, Wrapper, subject(resourceUrl) }`; `model.d.ts` types it
  as `CompositeNodeHandle<…NodeWrapper>` with a precise per-node wrapper interface
  (`ScrobbleTrackNodeWrapper`, …).
- The views are a **pure projection** of the fidelity-asserted manifest, derived at GENERATION time
  (`deriveNodeViews`): one flat view entity per node, a `nested` link projected as a plain IRI field,
  field names as projected (renames included). The view manifest is interpreted through the SAME
  audited `defineModel` path, so every view accessor gets the runtime's guard stack; the model.js
  per-node section is part of the fixed template (only the two JSON blobs vary).
- Only the view `Wrapper` is surfaced — a node's document identity comes from the handle's
  fragment-correct `subject()`, and cross-node MUST enforcement stays in the composite's graph-walk
  `parse`. A manifest with no composites exports a frozen empty `nodes`.

## Usage (Mode A)

```bash
npx federation-codegen gen \
  --ontology path/to/ontology.ttl \
  --shapes   path/to/profile.shacl.ttl \
  --config   path/to/codegen.config.json \
  --out      src/generated
```

The CLI writes the artifacts + `codegen.lock.json`, and fails closed if a fetched input's hash
differs from the lock (`--update-lock` to accept a reviewed change). The programmatic API is
`generateModel(input)` (see `src/index.ts`).

## Install

Workspace consumers depend on `workspace:*`. External consumers keep using
`github:jeswr/federation-codegen#<sha>` pins, served by the mirror (`scripts/mirror-publish.mjs`).
`dist/` is built fresh in the workspace and never committed here.

## Development

```bash
pnpm turbo run lint build typecheck test --filter=@jeswr/federation-codegen
```

Regenerate the bookmark package after a generator change with
`pnpm --filter @jeswr/federation-codegen... run build` then
`pnpm --filter @jeswr/solid-bookmark run codegen`. The `gen:example` script forwards to
the package command.

## Licence

MIT © Jesse Wright
