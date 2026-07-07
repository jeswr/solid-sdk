# @jeswr/federation-codegen

> Ontology-driven data-model codegen for the Solid app suite (design rev-3 **P0**). It
> deterministically compiles a **sector ontology (OWL/RDFS)** + its **SHACL profile** + a per-domain
> **codegen config** into a typed data model whose behaviour lives entirely in the audited
> [`@jeswr/model-runtime`](https://github.com/jeswr/model-runtime).

**Status:** alpha — P0. Generated artifacts carry **no executable logic**; all behaviour is in the
runtime, audited once.

## What it generates

For each `sh:NodeShape` in a domain's SHACL profile:

| Artifact | What it is |
|---|---|
| `model.d.ts` | Types only — precise `Data` / `Wrapper` / `Entity` interfaces. Zero runtime code. |
| `model.json` | The compiled shape-manifest — a **fidelity-asserted verified projection of `shapes.ttl`**, never a bespoke schema (§7.2). |
| `model.js` | A **fixed-template shim** — imports `@jeswr/model-runtime`, inlines the manifest, calls `defineModel`. Bytes vary only in the JSON. |
| `shapes.ttl` | The **skolemized, byte-reproducible** SHACL shape — the stable waist (§5). |
| `codegen-manifest.json` / `codegen.lock.json` | Input/output sha256s + adapter + runtime pins; the Mode-A lockfile (fail-closed on input drift). |

## Pipeline

```
ontology (OWL/RDFS) + SHACL profile + codegen config
  └─[L0] ontology-input adapter (swappable seam; V1 = owl-rdfs-v1)
  └─[L1] tier-a admission (fail-closed): labels+definitions, domain/range-or-waiver, SHACL coverage
  └─[L2] parse + SKOLEMIZE the SHACL profile  → shapes.ttl (byte-reproducible)
  └─     compile manifest (shape-derived + config-supplied guards)
  └─     FIDELITY ASSERTION (P0 exit) — model.json ↔ shapes.ttl, order-independent, fails on mismatch
  └─     emit model.d.ts / model.json / model.js
```

- **Admission (tier-a)** refuses to generate from an ontology/profile that would produce a
  silently-incomplete model (missing labels, un-domained/ranged properties, a literal without a
  datatype, a class without a NodeShape). `error` violations block; an unbounded-set `missing-cardinality`
  is an advisory `warning`.
- **The fidelity assertion** re-derives an order-independent projection of the merged shapes and
  asserts, field-for-field and constraint-for-constraint, that `model.json` covers it exactly — and
  that every guard flag with no shapes source traces to the committed config. A seeded manifest
  mutation makes it throw (proven in the test suite).
- **Determinism (§5):** `(generator artifact, input bytes) → output bytes`. Double-build + permuted
  input-order byte-equality is tested.

## The bookmarks pilot + the parity bar

`examples/bookmark/` generates the `@jeswr/solid-bookmark` model from that package's own ontology +
SHACL profile (the detailed `book:` vocabulary the fed-vocab bookmarks *sector* aligns to). The
package's **unmodified** test suite runs against the generated wrapper via a thin facade
(`examples/bookmark/facade.ts`) — the parity bar. **Result: 42/42 of solid-bookmark's suite passes**
against the generated model (`test/parity/`): 18 model tests, 7 IRI-filter tests, 6 vocab tests, and
11 SHACL-conformance tests (the generated model's output validated against the generated `shapes.ttl`
via `rdf-validate-shacl`). Every test is genuinely mechanical/accessor logic — nothing in
solid-bookmark falls outside what generation covers, which is why it is the pilot.

`test/generator/sector-divergence.test.ts` documents (honestly) why the fed-vocab **sector** profile
cannot yet drive this generation: it uses a different class IRI, models tags as `bookmark:hasTag`
`skos:Concept` (not `schema:keywords` literals), and omits `dct:created`/`dct:modified` — the §4
ratchet the sector must close first.

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
  cross-node MUST (`requiredFailClosed`) derives from a link's Violation-graded `sh:minCount ≥ 1` (G1).
- The **fidelity assertion** extends to the composite: every projected field traces to a shape
  property; a nested link maps an IRI-link property and a Violation link carries the required guard;
  and **every presence-MUST (`minCount ≥ 1`, Violation) of a node MUST be covered** — a
  security-critical constraint can never be silently dropped from the projection.
- A property that is neither a `field` nor a `link` is omitted (only Warning/Info properties may be —
  a MUST omission fails fidelity). A composite claims its node target classes exclusively (they are not
  also emitted as flat entities); each node has a distinct target class; composite documents are
  http(s)-scoped (the runtime filters/canonicalises link targets through the http(s) IRI filter).

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

## Install (GitHub, no build step)

`dist/` is committed, so the package installs and runs under `ignore-scripts=true`:

```bash
npm install github:jeswr/federation-codegen#main
```

**Publish-ordering note (P0).** This package depends on `@jeswr/model-runtime`, and the models it
*generates* `import` the runtime at the consumer's runtime — so the runtime must be resolvable for a
consumer. During local P0 the two packages are co-developed siblings, so the dependency is
`file:../model-runtime` (which resolves locally and lets the full parity suite run). **At publish time
the runtime is published FIRST**, and this dependency (plus the `import "@jeswr/model-runtime"` in the
generated `model.js`) repoints to `github:jeswr/model-runtime#<sha>` (or the npm range). Installing
`federation-codegen` from GitHub before `model-runtime` is published will not resolve the runtime —
this is a deliberate publish-ordering step, not a defect.

## Development

```bash
npm run gate        # lint + typecheck + test + build + check:dist
npm run gen:example # regenerate examples/bookmark/generated from its inputs
```

## Licence

MIT © Jesse Wright
