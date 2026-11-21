<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
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
| W2 Sheets: extract Suite workbook and column descriptor models into a generated shared package | implemented: four flat generated entities composed by layout/order facades; Suite imports the package | `packages/solid-sheets`, `apps/suite` | sst-ild.7 |
| P2 form runtime and generated RDFa forms (unify `solid-components`) | later | new package | sst-ild.4.4 |
| P3 bounded N3 mapping layer for cross-vocabulary migration | later | federation-codegen | sst-ild.4.5 |
| P4 ESM generation service | later | app or tool | sst-ild.4.6 |
| P5 fleet migration (drawing, chat-interop; task-model split; memory needs a sector) | drawing implemented: generated nine-field Scene plus facade; original 90-test oracle unchanged; remaining packages later | `packages/solid-drawing`, remaining model packages | sst-ild.4.7 |
| ild.9 `@jeswr/rdf-serialize/wrapper` helpers and consumer rewire | open | `packages/rdf-serialize` plus six consumers | sst-ild.9 |

G5 deliberately preserves canonical-first singleton migration reads. With
`sh:alternativePath`, SHACL counts the union for `maxCount`, whereas the runtime checks
each predicate separately and selects the guarded canonical value before aliases. Stale
conflicting legacy triples can therefore parse even when the emitted SHACL rejects the
union's `maxCount`. The reviewed solid-bookmark oracle is binding here (round-6 M1 declined).
Writes are canonical-only and clear aliases, so the runtime never produces such data.

Write-time alias migration keeps its shared 10,000-read preservation audit whenever
cleanup is possible. A setter/build field with no predicate aliases, or `mark` with no
type aliases, skips that audit only if no other owner in any migration-context manifest
declares aliases. Other owners remain conservative because co-typing and data-graph
subclasses can overlap their focus nodes. Alias-free edits therefore do not scan unrelated
subjects; explicit writes retain all guards and sanitization.

Multi-subject readers should pass an explicit runtime `createParseScope(dataset)` to
`entity.parse(url, dataset, { scope })`. One scope memoises class membership and shares a
100,000-read type/subclass budget (configurable 0–1,000,000) across roots and nested class
checks. Exhaustion is observable and sticky, with all subsequent class checks failing
closed. Scopes are bound to one unchanged dataset and must be discarded after mutation;
write paths never consult them. Parses without a scope keep independent 10,000-read checks.
The generator emits the optional `ParseOptions` parameter on every entity parse signature.

Two follow-ups are recorded rather than decided here: `model-runtime` serialises with
`n3.Writer` directly instead of through `@jeswr/rdf-serialize`, and it carries its own http(s)
IRI filter alongside rdf-serialize's `safeHttpIri`. Both are second occurrences and should
converge on rdf-serialize (sst-ild.4.8) once the bookmark flip proves behaviour is identical.

## Supported constructs

Admission is closed; this table records constructs added after the import. The package
READMEs hold the full inventory.

| Construct | Projection | Bounds |
|---|---|---|
| `sh:pattern "^[A-Z]{3}$"` on an `xsd:string` literal (ISO 4217 code shape) | shape-derived `guards.stringPattern: "upper-alpha-3"`: exactly three ASCII `A`-`Z` | Exact pattern text only; any other pattern, datatype, IRI field or `sh:flags` stays rejected. No regex is compiled from shape text. |
| `xsd:decimal` with config `"decimal": "exact"` (opt-in, per field) | manifest `decimal: "exact"`; TS `string` holding the exact lexical, scale preserved | Closed grammar `[+-]?[0-9]+(\.[0-9]+)?`, at most 64 characters. Not available on integer subtypes or with `sh:in`/numeric bounds. Unconfigured decimals keep the JS number mapping and byte-identical output. |
