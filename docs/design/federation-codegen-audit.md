<!-- AUTHORED-BY Codex GPT-5 -->

# Federation code-generation audit

Date: 2026-07-12

Scope: `solid-task-model`, `solid-bookmark`, `solid-drawing`, `solid-health-diary`,
`solid-chat-interop`, and `solid-memory`, compared with the ontology, SHACL, and alignment
artifacts under `packages/solid-federation-vocab/sectors/`.

Supplemental evidence: the top-level cross-sector `solid-federation-vocab/task.ttl`, each
package's local shapes, public exports, source, and tests. Those supplemental files identify gaps
and handwritten contracts; they are not silently promoted to sector code-generation inputs.

## Conclusion

None of the six packages is safely replaceable in full from the current sector ontology and
SHACL alone. Four have a useful schema-derived core, but all four require a handwritten policy or
interop layer. Two are not sector-generatable as packages: `solid-task-model` spans a cross-sector
task vocabulary plus tracker and contacts models, while `solid-memory` has no federation sector
or SHACL source.

The generator may own RDF vocabulary constants, shape-derived TypeScript records, and mechanical
typed accessors. It must not own network boundaries, runtime trust decisions, defaulting or
reconciliation policy, cross-resource invariants, or opaque non-RDF payloads unless those
behaviours are represented by an explicit, separately reviewed extension contract.

| Package | Federation mapping | Classification | Replacement blocker / handwritten behaviour that must survive |
|---|---|---|---|
| `solid-task-model` | No single sector. The task spine is the top-level cross-sector `task.ttl`; `futures` reuses `wf:Task`; `scheduling:Task` is a different class and wire model; the package's contacts surface belongs to `contacts`. | **NOT-GENERATABLE** | No sector SHACL describes the package's combined task, tracker, workflow, and SolidOS contacts API. Preserve dual-description compatibility, workflow defaults/transitions, task sorting/assignment helpers, relative-index resolution, structured-plus-legacy vCard reads, strict `mailto:`/`tel:` handling, symmetric http(s)-only filters, and the browser-safe root/Node-only shape split. |
| `solid-bookmark` | `bookmarks` | **GENERATABLE-CORE-PLUS-HANDWRITTEN-EXTENSIONS** | The sector can generate a sector-native bookmark model, but it uses `bookmark:` while the package writes `book:` through `skos:closeMatch`; the sector uses `bookmark:hasTag`/`skos:Concept` while the package uses `schema:keywords` strings. Preserve required-URL rejection on read, http(s) canonicalisation on write, tag trimming/sorting, text/default/timestamp policy, and the browser-safe shape-loader split. |
| `solid-drawing` | `drawing` | **GENERATABLE-CORE-PLUS-HANDWRITTEN-EXTENSIONS** | The sector can generate the small `drawing:Scene` descriptor core, but the package writes the aligned `draw:` vocabulary and has additional metadata and different title cardinality. Preserve fail-closed subject and required-canvas validation, Turtle IRI-injection escaping, exact-one parsing, optional-link filtering, lexical subject identity, the browser-safe split, and the byte-exact opaque-blob boundary. |
| `solid-health-diary` | `health/diet`, a sub-sector of `health` | **GENERATABLE-CORE-PLUS-HANDWRITTEN-EXTENSIONS** | This is the strongest source match: the package's vendored SHACL is byte-identical to the federation SHACL and uses the same `diet:` terms. Preserve owner-only WAC, read/write IRI filtering, fail-closed singleton and required-field parsing, exposure heuristics, lag-profile sanity/fallbacks, one-active-challenge policy, emergency rails, conclusion rules, and consent/coverage/marker genetics invariants. |
| `solid-chat-interop` | `social` | **GENERATABLE-CORE-PLUS-HANDWRITTEN-EXTENSIONS** | The sector can generate `social:Note`/`social:Feed`; alignments identify much of the AS2 spine. It cannot generate the package's richer AS2 shape, LongChat dialect, actionable `wf:Task` overlay, edit/delete/provenance fields, or adapter/reconciliation semantics. Preserve http(s)-only and injection-safe IRI handling on read/write, malformed-value isolation, text/date sanitation, fail-closed subjects, mapping precedence, dual writes, adapters, and author/provenance heuristics. |
| `solid-memory` | None. It links to social/chat resources but is not a social-sector model. | **NOT-GENERATABLE** | `mem:MemoryItem` and `mem:embeddingRef` are absent from the federation ontology and there is no sector SHACL. Preserve the entire model contract plus container-scope and credential guards, manual redirect refusal, type-index registration, conditional writes, sticky fail-closed tombstones, client search semantics, and http(s)-only parsing/building. |

## Classification rule

- **FULLY-GENERATABLE** means the current public and wire contract can be reconstructed from the
  sector ontology and SHACL plus deterministic generator conventions, with no package-specific
  runtime policy to retain.
- **GENERATABLE-CORE-PLUS-HANDWRITTEN-EXTENSIONS** means the schema is sufficient for constants,
  a typed record, and mechanical accessors, but a reviewed handwritten layer must remain around it.
- **NOT-GENERATABLE** means the current federation source has no single authoritative sector input
  capable of describing the package as currently bounded, even before runtime policy is
  considered. It does not mean a future ontology/SHACL source could never be authored.

`rdfs:domain`/`rdfs:range`, `sh:targetClass`, `sh:path`, cardinalities, datatypes, node kinds, and
controlled vocabulary individuals are generation inputs. Domain and range are inferential typing
statements, not required-field or cardinality constraints; SHACL owns those validation facts.
Generated accessors may report structural violations, but whether to reject a whole record, omit a
field, choose a fallback, or continue is handwritten policy. Ontology prose is useful
documentation, not an executable instruction to add defaults, perform network requests, choose
between legacy dialects, reject SSRF targets, or apply health inferences. Neither
`skos:closeMatch` nor `skos:exactMatch` authorizes code generation to substitute wire IRIs: both are
annotation-only reconciliation hints carrying no entailment in these sector files.

Controlled-vocabulary individuals may generate constants and open codecs. They may generate an
exhaustive TypeScript union only when SHACL supplies an explicit closed set such as `sh:in`, or a
separate generator manifest declares closure. Unknown/future concepts otherwise remain
representable and are handed to policy code.

## Per-package findings

### `@jeswr/solid-task-model`

**Mapping.** There is no faithful one-sector mapping. The task portion implements reused
`wf:Task` terms documented by the top-level `solid-federation-vocab/task.ttl`, not a file in
`sectors/`. `futures` subclasses `wf:Task` for app and infrastructure proposals, but its SHACL
describes futures proposals rather than generic tasks or trackers. `scheduling` has its own
`sched:Task`, `sched:summary`, `sched:dueTime`, and completion model; treating that as the same wire
contract would be a migration, not code generation. The package also exports a SolidOS
`wf:Tracker` workflow model and a vCard address-book/person/group model; the latter overlaps the
`contacts` sector.

**Derivable.** `task.ttl` can produce constants for the documented `wf:`, `dct:`, `as:`, and `tm:`
terms. The package-local task, tracker, and contacts SHACL files could generate basic records and
accessors, but those files are not federation sector inputs and therefore do not satisfy the
requested source-of-truth direction.

**Handwritten contract.** Preserve:

- dual read/write of `wf:description` and `dct:description`;
- `wf:Open`/`wf:Closed` state projection, timestamp defaults, closing-time behaviour, task
  assignment comparison, and stable rank/date sorting;
- the frozen default workflow, transition authorization, status ordering, fallback to `wf:Task`,
  and filtering of malformed workflow/member IRIs;
- SolidOS vCard compatibility: structured and legacy-direct email/telephone reads, structured
  writes, relative index resolution, default index documents, and people/group index builders;
- the distinct reviewed encoders for opaque `mailto:` and `tel:` IRIs and the http(s)-only guards
  for WebIDs, owners, projects, members, provenance, and other links; and
- lazy RDF parsing and the browser-safe root/subpaths separated from the Node-only filesystem
  shape loader.

The package should be split by authoritative model before any generation attempt: cross-sector
task, tracker/workflow, and contacts are separate inputs and compatibility surfaces.

### `@jeswr/solid-bookmark`

**Mapping.** The package belongs to the `bookmarks` sector.

**Derivable.** `bookmarks.ttl` and `bookmarks.shacl.ttl` are sufficient to generate constants and
a basic wrapper for a sector-native `bookmark:Bookmark` with `schema:url`, `dct:title`,
`bookmark:archived`, `bookmark:notes`, `dct:description`, and `bookmark:hasTag`. Cardinality,
literal/IRI kinds, and basic optional/required TypeScript fields follow mechanically from SHACL.

That generated type is not the current package. The package's canonical class and local
predicates are in `https://w3id.org/jeswr/bookmark#`; the federation only connects them with
annotation-only `skos:closeMatch`. More importantly, sector tags are `bookmark:hasTag` IRIs typed
`skos:Concept`, while the package deliberately stores flat Linkding tags as
`schema:keywords` string literals. The package additionally covers `dct:created` and
`dct:modified`, which the sector shape omits, and its own shape adds the http(s) URL pattern that
the federation shape omits.

**Handwritten contract.** Keep the symmetric URL boundary: an invalid/non-http(s) required URL is
dropped during building and causes parsing to reject the whole bookmark, so hostile pod RDF is
never surfaced as a clickable link. Keep WHATWG canonicalisation, blank optional-text omission,
explicit `archived=false`, default creation time, whitespace-only tag rejection, stable tag sort,
and the browser-safe root versus Node-only `./shape` split.

A future generated core needs an explicit projection decision: either make `book:` the normative
sector vocabulary or migrate consumers to `bookmark:`. The generator must not guess from
`skos:closeMatch`.

### `@jeswr/solid-drawing`

**Mapping.** The package belongs to the `drawing` sector.

**Derivable.** The sector files can generate a compact `drawing:Scene` wrapper with title,
`drawing:sceneDocument`, `drawing:schemaVersion`, and `drawing:thumbnail`. Its single NodeShape is
the smallest sector-native generation input in this audit.

It is not the complete current package contract. The package uses the separately owned `draw:`
namespace connected by annotation-only close matches. Its shape also contains `dct:created`,
`dct:modified`, `draw:viewBackgroundColor`, `schema:about`, and
`prov:wasGeneratedBy`; the sector does not. Conversely, the sector makes `dct:title` a MUST while
the package makes it optional. Generating one over the other would change both RDF IRIs and
accepted documents.

**Handwritten contract.** Preserve the two different IRI roles. Required subject bases retain
their lexical RDF identity while Turtle-forbidden characters are escaped; object links may be
WHATWG-canonicalised. Invalid subjects and required scene-document links fail closed; invalid
optional links are omitted. Parsing enforces exact-one cardinality and datatype/node-kind checks
rather than selecting an attacker-controlled first value. The canvas remains a separate,
byte-exact `.excalidraw` resource: generated code may expose its IRI, but must never parse, shred,
normalise, or re-serialise the JSON blob. The root must remain browser-safe and filesystem-backed
ontology/shape loading must remain on `./shape`.

### `@jeswr/solid-health-diary`

**Mapping.** The package is the implementation of the `health/diet` sub-sector.

**Derivable.** This is the closest authoritative match. The vendored
`shapes/diet.shacl.ttl` is byte-identical to the sector SHACL. The vocabulary has the same
structural/model statements and IRIs; its differences are ordering/comments plus two descriptive
annotations, not a second namespace or wire model. A generator can therefore own:

- constants for the modeled classes, their properties, and controlled-value schemes;
- constants and open codecs from controlled concept individuals and `skos:notation`, with closed
  unions only where an explicit closure contract exists;
- shape-derived record types for Meal/FoodItem/Exposure, Symptom, EliminationProtocol,
  ToleranceConclusion, GeneticSummary/HlaMarker, and DietPlan; and
- basic typed getters/setters and mechanical cardinality/datatype handling.

Even here, SHACL conformance is not the complete safety contract.

**Handwritten contract.** Preserve owner-only, write-first WAC construction and failure handling;
resource/owner URL validation; symmetric http(s)-only filtering of patients, OFF references,
evidence, and linked records; fail-closed handling of duplicate singleton values and missing or
invalid load-bearing dates; and browser-safe/Node-only entry splitting.

The following domain policy is not code-generatable from the schema: Open Food Facts tag/category
exposure heuristics and uncertainty precedence; emergency symptom rails; finite, non-negative,
ordered lag-profile validation and trusted-prior fallback; the one-active-challenge invariant;
protocol and conclusion policy; corrupt-exclusion rejection; summary-only genetics; compile-time
and runtime consent; negative-predictive coverage checks; source/provenance consistency; and
rollup-to-marker consistency. Some of these overlap SHACL constraints, but the fail-closed read and
write behaviour remains an application decision and must retain adversarial tests.

### `@jeswr/solid-chat-interop`

**Mapping.** The package belongs to `social`.

**Derivable.** The sector can generate `social:Note` and `social:Feed` constants, records, and
accessors for content, author, publication time, feed, media type, and reply edge. The alignment
file has exact matches for most of that spine to ActivityStreams 2.0, but these remain
annotation-only; `social:inFeed` is only a close match to `as:context`.

The package's actual canonical shape targets `as:Note` and is substantially richer: edit and
delete metadata, PROV-O attribution, and a `wf:Task` overlay are absent from the sector shape. Its
purpose is also reconciliation, not just a typed record: it reads/writes AS2 and SolidOS LongChat
and exposes an external adapter seam plus a LibreChat implementation.

**Handwritten contract.** Preserve http(s)-only filtering and Turtle-injection-safe escaping on
both reads and writes, required-subject failure, per-field malformed-value isolation, unsafe text
control sanitisation, invalid-date dropping, and text/plain defaults. Preserve the canonical
mapping table and precedence rules; AS2/LongChat dual writes; reply direction; open/closed conflict
resolution; edit/delete/provenance/task overlays; adapter privacy boundaries; ID resolution; and
the LibreChat human-versus-agent attribution heuristic. A generated `social:Note` wrapper may sit
under this reconciler, but cannot replace it.

### `@jeswr/solid-memory`

**Mapping.** None. Memory items can point at AS2 activities or pod-chat rooms, but that makes social
data a provenance target, not the memory's sector.

**Derivable.** Nothing package-specific is derivable from the current sector directory. Neither
`mem:MemoryItem` nor `mem:embeddingRef` occurs there, and the package ships no SHACL artifact. A
generator could recover reused standard-vocabulary constants, but not the class, field
cardinality, required body, tombstone semantics, or embedding-reference contract.

**Handwritten contract.** Until a memory sector ontology and SHACL profile exist, the entire typed
model remains authoritative. Even after such a profile lands, preserve http(s)-only canonical and
injection-safe fields; required subject/model recognition; client-side search matching and
forgotten-item exclusion; Type Index registration; same-origin and descendant-path enforcement;
userinfo/query/fragment refusal; container-root protection; manual redirect refusal for every
credentialed request; ETag/`If-Match` handling; and sticky tombstone preservation that fails closed
when a pre-read cannot determine whether an update would resurrect forgotten data.

## Pilot recommendation

There is **no current fully-generatable package**, so a pilot must not be described or merged as a
whole-package replacement.

For a generator-mechanics pilot, use the **`drawing` sector's sector-native core**. It has one
class, one NodeShape, four constrained properties, no RDF lists, no controlled-value codec, and no
nested node shape. Generate it into a non-exported `src/generated/` fixture/module. Exercise its
builder with valid and invalid RDF fixtures, validate the emitted RDF against the sector SHACL,
round-trip it through the generated parser, and snapshot the generated declarations and constants.
Do not overwrite or publish it from `solid-drawing` in the pilot. Retain the existing `draw:`
package as the handwritten compatibility/policy facade.

Before the generated core may be integrated behind the `solid-drawing` facade, the federation
source and an explicit projection/migration plan must reconcile:

1. canonical `drawing:` versus `draw:` IRIs;
2. title cardinality;
3. the five package-only metadata fields;
4. http(s) and exact-one runtime read policy; and
5. mandatory handwritten policy hooks that generated accessors cannot bypass for fail-closed IRI
   handling, browser-safe exports, and the byte-exact opaque-blob boundary; and
6. public-API/semver compatibility plus dual-read or migration handling for existing `draw:` data.

If the pilot requirement is strictly “replace an existing package with generated output,” defer
the pilot: none of these six currently meets that bar. `health/diet` has the best source fidelity,
but it is the worst first pilot because its handwritten health, privacy, and genetics safeguards
are extensive and safety-sensitive.

## Code-generation boundary

Use a non-overwriting structure so regeneration cannot delete reviewed logic:

```text
src/generated/       ontology/SHACL-owned constants, records, accessors
src/policy/          IRI, URL, SSRF, redirect, fail-closed and domain guards
src/interop/         legacy namespaces, adapters, reconciliation and migrations
src/index.ts         stable reviewed public facade
```

Generation should fail when an existing generated field changes IRI, node kind, datatype, or
cardinality without an explicit migration record. Characterization and adversarial tests for the
handwritten layers must run unchanged after the generated core is substituted. For a generated
sector-native writer, green SHACL validation is necessary but not evidence that hostile RDF is
safe to surface or that a builder preserves all cross-resource and network invariants. Legacy
compatibility inputs may intentionally use a different shape and must be checked against their
declared compatibility contract before projection.

## Evidence limits

This is a source audit, not an implementation design for `federation-codegen`. No generator exists
in this workspace to test, and no package code was changed. “Derivable” means mechanically present
in the checked-in ontology/SHACL graph, not inferred from README prose or reconstructed from the
handwritten implementation. Runtime behaviour was identified from public exports, source,
characterization/security tests, and package-local shapes.
