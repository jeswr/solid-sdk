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

## Phase map

| Phase | State | Workspace target | Bead |
|---|---|---|---|
| P0 mapping, admission, generator, bookmarks pilot | done in standalone; imported here | `packages/federation-codegen`, `packages/model-runtime` | sst-ild.4.1 |
| G1 to G4 generator readiness | done; imported | same | (in .4.1) |
| G5 legacy-IRI read aliases: read old and canonical IRIs, canonical first, write canonical only | implemented; landing in PR #213 | derived from SHACL multiple `sh:targetClass` and `sh:alternativePath`; canonical member is the ontology-declared one | sst-ild.4.2 |
| B bookmarks reference migration | open, needs G5 | `packages/solid-bookmark` flips to generated core plus facade | sst-ild.7.1 |
| Bookmarks sector ratchet: package profile (`book:`, `schema:keywords`, timestamps) versus `sectors/bookmarks` | needs Jesse (normative vocabulary) | `packages/solid-federation-vocab` | sst-ild.7.2 |
| P1 workspace codegen task plus a second migration (`solid-health-diary`, the closest sector match) | open | turbo `codegen` check, `packages/solid-health-diary` | sst-ild.4.3 |
| M media: import `jeswr/solid-listening`, generate `ScrobbleData` composite, flip | open (unblocked) | `packages/solid-listening` | sst-ild.7.3 |
| Media `hadParticipant` MUST relaxation | already done: `sectors/media/media.shacl.ttl` grades it `sh:Warning` | media sector | sst-ild.7.4 (closed) |
| S scheduling: import `jeswr/solid-scheduling`, ratchet sector, generate, flip | open | `packages/solid-scheduling` | sst-ild.7.5 |
| R generate-not-handwrite charter rule; re-brief contacts, recipe, collectibles | open | `AGENTS.md`, lane briefs | sst-ild.7.6 |
| P2 form runtime and generated RDFa forms (unify `solid-components`) | later | new package | sst-ild.4.4 |
| P3 bounded N3 mapping layer for cross-vocabulary migration | later | federation-codegen | sst-ild.4.5 |
| P4 ESM generation service | later | app or tool | sst-ild.4.6 |
| P5 fleet migration (drawing, chat-interop; task-model split; memory needs a sector) | later | model packages | sst-ild.4.7 |
| ild.9 `@jeswr/rdf-serialize/wrapper` helpers and consumer rewire | open | `packages/rdf-serialize` plus six consumers | sst-ild.9 |

Two follow-ups are recorded rather than decided here: `model-runtime` serialises with
`n3.Writer` directly instead of through `@jeswr/rdf-serialize`, and it carries its own http(s)
IRI filter alongside rdf-serialize's `safeHttpIri`. Both are second occurrences and should
converge on rdf-serialize (sst-ild.4.8) once the bookmark flip proves behaviour is identical.
