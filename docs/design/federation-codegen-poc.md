<!-- AUTHORED-BY Codex GPT-5 -->
# Federation code generation proof of concept

Status: review-only proof of concept. The generated package is private and must not be published.

## Decision

**NO-GO for replacing the hand-written model packages. GO only for using SHACL-driven output as
a reviewed structural scaffold.** The experiment proves that ontology + SHACL can reliably generate
vocabulary constants and routine `@rdfjs/wrapper` accessors. It also proves that those inputs do not
contain enough policy to recreate the security and application semantics in
`@jeswr/solid-bookmark`.

The generator lives in `tools/federation-codegen`; the committed proof output is
`tools/federation-codegen/generated/bookmarks-sector`. It consumes the bookmarks sector ontology
and SHACL profile from `packages/solid-federation-vocab`. It does not modify or generate into
`packages/solid-bookmark`.

## Minimal projection

The PoC supports direct `sh:property` constraints on a `sh:NodeShape` with one `sh:targetClass`.
It maps:

- `sh:datatype` for `xsd:string`, `xsd:boolean`, `xsd:date`, `xsd:dateTime`, and `xsd:double` to
  datatype-preserving `LiteralAs`/`LiteralFrom` accessors (`xsd:integer` is rejected because an RDF
  integer is unbounded and cannot be losslessly represented by JavaScript `number`);
- `sh:nodeKind sh:IRI` or `sh:class` to `NamedNodeAs`/`NamedNodeFrom` accessors;
- `sh:minCount >= 1` plus `sh:maxCount 1` to `RequiredFrom`/`RequiredAs`;
- `sh:maxCount 1` to `OptionalFrom`/`OptionalAs`;
- unbounded cardinality to a live `SetFrom` set;
- `sh:targetClass` to a `TermWrapper` subclass with `types`, `mark`, and `is<Class>` helpers.

The ontology is not decorative input: the generator rejects a target class that is not an
`owl:Class`, and rejects a shape path in the ontology's own namespace unless the ontology declares
it as an object or datatype property. Unsupported property paths, bounded counts other than one,
datatypes, and SHACL predicates fail generation instead of silently weakening the model or becoming
`unknown`.

Prefix mappings come from N3's Turtle parser rather than source-text scanning. Conflicting prefix
mappings, normalized namespace constant collisions, duplicate emitted class/member names, and
multiple property shapes for one RDF path also fail generation.

The emitted accessors are a structural view. SHACL validation remains necessary because an
accessor cannot enforce every graph constraint. In particular, an unbounded `sh:class` property is
represented as `Set<string>`: it guarantees IRI objects, but another node still has to carry the
required RDF type.

## Generated versus hand-written bookmark model

| Surface | Generated bookmarks sector | Hand-written `solid-bookmark` | Result |
|---|---|---|---|
| Class | `sectors/bookmarks#Bookmark` | `bookmark#Bookmark` | Same concept via an annotation-only `skos:closeMatch`, different RDF identity |
| Type helpers | live `rdf:type` set, `mark()`, `isBookmark` | live `rdf:type` set, `mark()`, `isBookmark` | Structural match, class IRI differs |
| URL | required single `schema:url` IRI | optional wrapper accessor around the same IRI; required by builders/parsers | Predicate and RDF term match; lifecycle and trust policy do not |
| Title | optional single `dcterms:title` string | optional single `dcterms:title` string | Match |
| Description | optional single `dcterms:description` string | optional single `dcterms:description` string | Match |
| Notes | optional single `sectors/bookmarks#notes` string | optional single `bookmark#notes` string | Datatype/cardinality match; predicate IRI differs |
| Archived | optional single sector `xsd:boolean`, absence is `undefined` | package `xsd:boolean`, absence reads `false`, builders write an explicit default | Datatype/cardinality match; IRI and default policy differ |
| Tags | unbounded `sectors/bookmarks#hasTag` IRI values, each a `skos:Concept` | unbounded `schema:keywords` string literals | Deliberate wire-model mismatch |
| Created/modified | absent from the sector shape | optional `dcterms:created`/`modified`; builder supplies `created` | Cannot be generated from these inputs |
| Plain data API | none | `BookmarkData` plus stable sorted projection | Cannot be inferred |
| Build/parse/serialise | typed wrapper only | builders, `n3.Writer`, `@jeswr/fetch-rdf` parse seam | Cannot be inferred |

The common structural core is real: class stamping, one required IRI, four optional scalar
properties, and one set can all be emitted deterministically. It is not API or wire compatibility.

## What generation cannot produce

The sector inputs do not encode the hand-written model's security and operational decisions:

- allow only absolute HTTP(S) bookmark targets on both read and write;
- canonicalise WHATWG URLs so whitespace/control characters never enter an RDF IRI;
- apply any network-destination/SSRF policy before dereferencing a target (neither SHACL nor a
  generated IRI accessor can decide which hosts are safe);
- reject the whole parsed record when the required target is missing or hostile;
- fail closed at builders rather than emit a graph known to violate a MUST;
- reject multiple values for optional `sh:maxCount 1` fields on untrusted reads (the generated
  `OptionalFrom` projection, like the low-level hand-written accessor, returns the first value);
- default `archived` to `false` and write that default explicitly;
- default `created` to the current time;
- drop empty text, trim/deduplicate tags, and return tags in stable order;
- parse through `@jeswr/fetch-rdf`, including correct base-IRI/content-type handling;
- serialise through `n3.Writer` with the package's public prefix/API conventions;
- decide that Linkding tags are flat `schema:keywords` literals rather than managed SKOS concepts;
- provide browser-safe and Node-only entry-point boundaries.

The proof test intentionally writes `javascript:alert(1)` through the generated `schema:url`
accessor and validates it successfully against the sector shape. That is not a validator defect:
the sector shape requires an IRI but has no HTTP(S) pattern. The hand-written shape and code add the
missing policy. Even if a future SHACL profile carried a pattern, turning every pattern into safe
normalisation, error handling, and UI policy would still require reviewed code.

The hand-written HTTP(S) scheme/canonicalisation guard should not be overstated as complete SSRF
protection: it still accepts loopback and private-network HTTP(S) URLs. Any code that dereferences a
bookmark target needs a separate guarded-fetch policy. The generated model supplies neither layer.

## Design forks and open questions

### Cross-ontology mappings

Minimal choice: generate the exact target and path IRIs in the selected SHACL profile. Do not treat
`skos:closeMatch` in `bookmarks-alignments.ttl` as substitution or entailment. The alignments say
the terms are close, not identical, and the tag models prove that a rewrite can change RDF term
kind as well as predicate.

Open question: should a future generator support an explicit, versioned migration mapping that can
describe predicate replacement, value transformation, and compatibility direction? Annotation
properties alone are insufficient and unsafe as executable mapping instructions.

### `model.json`

Minimal choice: no `model.json` input. The generator builds a small in-memory projection directly
from ontology + SHACL and commits only ordinary TypeScript/package artifacts. This tests whether the
federation sources are sufficient without hiding extra semantics in a second schema.

Open question: if accessor names, package entry points, subject conventions, default values, or
wire migrations need configuration, is a reviewed manifest the right explicit extension point? If
so, it is application policy and must not be presented as derived from SHACL.

### Security hardening

Minimal choice: generated files contain only structural accessors and explicitly say they are not a
security-reviewed model. The PoC does not emit validator stubs, partial URL checks, builders, or
unsafe extension hooks that could be mistaken for protection.

Open question: should future generated packages expose a generated structural base class that a
hand-written, security-reviewed facade wraps; support protected handwritten regions; or consume a
separate policy plugin? A base-plus-facade split has the clearest provenance, but needs an API and
regeneration strategy before adoption.

### SHACL coverage

Minimal choice: direct paths and a small datatype/cardinality subset; reject unsupported constructs.
No support for property paths, `sh:or`, `sh:xone`, `sh:node`, qualified counts, language constraints,
`sh:pattern`/length constraints, SPARQL constraints, defaults, or cross-resource invariants. A bare
`sh:class` is deliberately narrowed to a named-node string in this PoC even though SHACL can type a
blank node; that representation choice also needs a broader-sector decision.

Open question: which SHACL subset is the federation's code-generation contract, and how is a shape
outside that subset reported without blocking unrelated shapes? The answer needs conformance tests
across more than this one sector before any replacement plan.

## Go/no-go criteria after the PoC

A future replacement proposal should remain blocked until it demonstrates all of the following:

1. an explicit mapping/policy format with provenance distinct from ontology-derived code;
2. fail-closed generated or hand-written facades for all SHACL MUSTs and untrusted reads;
3. migration compatibility for existing package IRIs and public APIs;
4. coverage of the SHACL constructs actually used across every target sector;
5. security review and adversarial tests per generated package, not just generator unit tests.

Until then, generation can remove repetitive vocabulary/accessor work, but the reviewed hand-written
models remain authoritative.
