<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# 0003 Domain-model code generation in the workspace

Status: accepted for implementation (1 Nov 2026). Beads: sst-ild.4 (codegen rev-3), sst-ild.7
(generate domain models from the federation), sst-ild.9 (shared wrapper write idiom).

## Sources

Jesse signed off codegen rev-3 on 6 Jul 2026 (gist `4a6d6489…`) and the course-correct plan on
7 Jul (gist `2d385272…`). Cloud sessions cannot read gists, so the record used here is the code
and READMEs those designs produced: `jeswr/model-runtime` (`569c94e`) and
`jeswr/federation-codegen` (`800dcfa`). Both repos implement P0, phase G (G1 to G4) and the
phase M composite kind, and pass solid-bookmark's 42-test suite verbatim through a facade.

## Decisions

1. **Import both repos with full history** as `packages/model-runtime` and
   `packages/federation-codegen`. Both are `securityCritical`: the runtime interprets every
   generated model, and a generator bug can drop a MUST from a manifest. The standalone repos
   become read-only mirrors.
2. **Retire the October proof of concept** in `tools/federation-codegen` (Codex, review-only,
   NO-GO). It reused the package name, generated plain wrapper classes with no runtime guards,
   and was written without rev-3 in view. Its five go/no-go criteria are already met or tracked:

   | PoC criterion | rev-3 answer |
   |---|---|
   | Explicit policy format with provenance | `codegen.config.json`; fidelity traces every non-shape guard to it |
   | Fail-closed handling of MUSTs and untrusted reads | runtime guard stack; G1 severity-aware `requiredFailClosed` |
   | Compatibility with existing IRIs and APIs | per-package facade plus the oracle method; legacy-IRI reads are gap G5 below |
   | Coverage of SHACL constructs used by every sector | admission rejects unsupported input; per-sector ratchet before each flip |
   | Security review per generated package | the runtime is reviewed once; each flip PR reviews its facade |

   `docs/design/federation-codegen-audit.md` stays: it lists the hand-written policy each
   facade must keep.
3. **Layering (ADR-001 D1).** `model-runtime` sits with the data models above the plumbing
   layer and depends only on `@jeswr/fetch-rdf`, `@rdfjs/wrapper` and `n3`. Apps consume
   generated models through their model package, never the generator. `federation-codegen` is
   build-time only: model packages take it as a devDependency. No LDO.
4. **Oracle method for every flip.** Freeze the hand-written package's tests as the oracle,
   generate the core from the package's ontology and SHACL, add a facade of at most 150 lines
   that keeps the public export surface, run the oracle verbatim at 100%, then flip the package.
   Consumers see no API change.
5. **sst-ild.9 home.** The duplicated `objectTerms` / `addIri` / `addLiteral` helpers (solid-a2a,
   solid-odrl, solid-vc, solid-agent-card, federation-client, federation-registry) move to a
   new `@jeswr/rdf-serialize/wrapper` subpath. Every consumer already depends on
   rdf-serialize, and `escapeIri` (the write chokepoint those helpers call) lives there.

## Admission coverage (generator lanes A and B: sst-ild.4.3.1–4)

| Input construct | Admission and runtime projection |
|---|---|
| `sh:class C` with direct named ontology individuals, C unprojected | Closed sorted IRI enum (`in` plus `guards.iriEnum: true`); intersect explicit `sh:in`; literal-union TypeScript type. Emitted SHACL lowers the class to `sh:in`. Invalid supplied writes throw existing `TypeError`; reads retain severity-graded drops. A Warning-graded concept class still becomes a strict runtime enum (nonmember writes throw, reads drop), while emitted `sh:in` retains `sh:Warning`: runtime membership enforcement is stricter than the advisory SHACL severity. Blank individuals and inferred subclasses are excluded. |
| `sh:class C` with zero named individuals, a projected C, an explicit `sh:node`, or a configured composite link | Existing class/link rules; never invent an enum or bypass class conformance. Only used concept classes are exempt from NodeShape coverage; labels and definitions still apply. |
| Several NodeShapes targeting the same canonical class and alias set | One entity under the class config; shape-IRI order; merge property constraints, retaining source severity and messages. Compatible same-path bounds/enums intersect; differing datatype/class/nodeKind/node/name/pattern or alternative paths, impossible counts/bounds, and empty enum intersections reject with both shapes named. Presence is fail-closed when a source has Violation-grade `minCount >= 1`. |
| Duplicate property paths inside one NodeShape, mismatched alias focus sets across merged shapes, or anonymous property shapes reused across classes | Rejected; no overwrite, widening of legacy focus sets or cross-class skolem identity reuse. Shared anonymous properties within one class group keep one identity. |
| Competing flat entity configs, or flat/composite claims to the same class | Rejected rather than selecting the first config. Existing composite ownership/tree checks still apply. |
| Scalar property `sh:hasValue` | One compatible exact IRI/canonical literal term; scalar/enum fields only. Retain strongest source severity across merged constraints; conflicting values reject. Parse grades absence/mismatch like missing required data. Build/setters throw before mutation. TypeScript retains the base scalar/enum type. Defaults, collections and nested links reject. |
| Node-level `sh:not`, `sh:and`, `sh:or` | Closed trees over field `sh:hasValue` and qualified-minimum atoms. Nonempty well-formed lists; no shared/cyclic expression nodes or nested annotations. Logical depth ≤4; ≤16 atoms per source NodeShape. Retain each merged source IRI, severity and message; deterministic JSON and exact fidelity checks. Violation rejects parse and staged writes; Warning/Info remain advisory on reads. |
| `sh:qualifiedMinCount` + `sh:qualifiedValueShape` in invariant trees | Positive `xsd:integer` ≤16 on composite links or class-linked IRI collections. Inner paths belong to the linked entity. Count distinct nodes only after their own reader succeeds; failed parses count false. Qualified context switches add no logical depth; inner logical operators do. Reads share bounded raw-read/visit budgets and cycle checks; exhaustion fails closed under negation. Child setters and generated node lenses recheck parent invariants atomically. |
| Other logical/qualified forms | Still rejected: `sh:xone`, qualified maxima/disjointness, `sh:node` in logical lists, complex expression paths, unknown predicates and out-of-bound nesting/counts. Full diet CLI admission now passes its consent/genetic constructs; independent Meal.hasItem collection projection and eight vocabulary domain/range gaps still block the full profile. |
| Ordered config `fields.<name>.ordered: { position: <IRI>, value: <IRI> }` | Exact distinct safe predicate keys; matching direct `sh:node` to one named, single-target item NodeShape. Item shapes are owned by ordered fields, never also flat/composite entity configs. No item aliases/merged shapes, extra properties, scalar link guards or unrepresented constraints. |
| Ordered item position | Exactly `xsd:integer`, `minCount 1`, `maxCount 1`; optional safe-integer `minInclusive <= 1` (build starts at 1). Other position constraints reject. |
| Ordered item value | Exactly one value (`minCount 1`, `maxCount 1`), a previously validated literal datatype or explicit `sh:IRI` with existing scalar guards. Every item constraint is fidelity checked. Defaults and set-only config policies reject. Data/accessor type is `readonly T[]` with a replacing setter, including composite node lenses. |
| Ordered runtime | Numeric sorting; duplicate values/gaps preserved; duplicate positions or any invalid item reject at outer Violation grade, Warning/Info drop the whole field. Safe same-document http(s) NamedNodes only; blank nodes reject consistently with composite traversal. Require data-graph item-class membership. Cap 256 items and 10,000 shared raw reads per ordered field; migration's existing aggregate cap still applies. |
| Ordered RDF writes and normalized SHACL | Mint `<document>#<resolvedFieldName>-<n>`, positions 1..n and item types. Replacing clears links and only the field's item-class/position/value triples on exclusively referenced local items; preserve unrelated/shared/foreign data and reject subject collisions atomically. Normalized SHACL adds explicit item `sh:class` and `sh:nodeKind sh:IRI`: targetClass alone does not constrain `sh:node` values. Negative positions follow the optional lower bound; position uniqueness and caps are runtime policies. |

All original shape triples remain visible to admission. Existing single-shape models and
ordinary `sh:in` write behavior retain their generated bytes and runtime contract.

## Phase map

| Phase | State | Workspace target | Bead |
|---|---|---|---|
| P0 mapping, admission, generator, bookmarks pilot | done in standalone; imported here | `packages/federation-codegen`, `packages/model-runtime` | sst-ild.4.1 |
| G1 to G4 generator readiness | done; imported | same | (in .4.1) |
| G5 legacy-IRI read aliases: read old and canonical IRIs, canonical first, write canonical only | implemented; merged in #213 | derived from SHACL multiple `sh:targetClass` and `sh:alternativePath`; canonical member is the ontology-declared one | sst-ild.4.2 |
| B bookmarks reference migration | done (#232) | `packages/solid-bookmark` flips to generated core plus facade | sst-ild.7.1 |
| Bookmarks sector ratchet: package profile (`book:`, `schema:keywords`, timestamps) versus `sectors/bookmarks` | needs Jesse (normative vocabulary) | `packages/solid-federation-vocab` | sst-ild.7.2 |
| P1 workspace codegen task plus a second migration (`solid-health-diary`, the closest sector match) | guard in #263; health-diary blocked on generator gaps (sst-ild.4.3.1 to .4) | turbo `codegen` check, `packages/solid-health-diary` | sst-ild.4.3 |
| M media: import `jeswr/solid-listening`, generate `ScrobbleData` composite, flip | imported; already flipped in July, regenerated with the hardened generator | `packages/solid-listening` | sst-ild.7.3 |
| Media `hadParticipant` MUST relaxation | already done: `sectors/media/media.shacl.ttl` grades it `sh:Warning` | media sector | sst-ild.7.4 (closed) |
| S scheduling: import `jeswr/solid-scheduling`, ratchet sector, generate, flip | implemented: generated Task + RecurrenceRule composite and Calendar behind facades; sector ratchet still open (normative) | `packages/solid-scheduling` | sst-ild.7.5 |
| R generate-not-handwrite charter rule; re-brief contacts, recipe, collectibles | rule in AGENTS.md; re-briefs via the orchestrator | `AGENTS.md`, lane briefs | sst-ild.7.6 |
| P2 form runtime and generated RDFa forms (unify `solid-components`) | later | new package | sst-ild.4.4 |
| P3 bounded N3 mapping layer for cross-vocabulary migration | later | federation-codegen | sst-ild.4.5 |
| P4 ESM generation service | later | app or tool | sst-ild.4.6 |
| P5 fleet migration (drawing, chat-interop; task-model split; memory needs a sector) | later | model packages | sst-ild.4.7 |
| ild.9 `@jeswr/rdf-serialize/wrapper` helpers and consumer rewire | open | `packages/rdf-serialize` plus six consumers | sst-ild.9 |

G5 deliberately preserves canonical-first singleton migration reads. With
`sh:alternativePath`, SHACL counts the union for `maxCount`, whereas the runtime checks
each predicate separately and selects the guarded canonical value before aliases. Stale
conflicting legacy triples can therefore parse even when the emitted SHACL rejects the
union's `maxCount`. The reviewed solid-bookmark oracle is binding here (round-6 M1 declined).
Writes are canonical-only and clear aliases, so the runtime never produces such data.

Two follow-ups are recorded rather than decided here: `model-runtime` serialises with
`n3.Writer` directly instead of through `@jeswr/rdf-serialize`, and it carries its own http(s)
IRI filter alongside rdf-serialize's `safeHttpIri`. Both are second occurrences and should
converge on rdf-serialize (sst-ild.4.8) once the bookmark flip proves behaviour is identical.
