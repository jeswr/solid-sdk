<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 4.8 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/model-runtime

> **Experimental, AI-agent-generated.** Lives in `packages/model-runtime` of the
> [`jeswr/solid-sdk`](https://github.com/jeswr/solid-sdk) workspace; the standalone
> `jeswr/model-runtime` repository becomes a read-only build mirror. Design of record:
> [`decisions/0003-domain-model-codegen.md`](../../decisions/0003-domain-model-codegen.md).

> The **one audited generic runtime** for the [`@jeswr/federation-codegen`](https://github.com/jeswr/federation-codegen)
> pipeline. It interprets a JSON **shape-manifest** to parse / validate / read / write RDF over
> [`@rdfjs/wrapper`](https://github.com/rdfjs/wrapper), carrying the full **guard inventory** that the
> six hand-written `@jeswr` data-model packages (`solid-bookmark`, `solid-task-model`, `solid-drawing`,
> `solid-chat-interop`, `solid-memory`, `solid-health-diary`) each duplicated.

**Status:** alpha — P0 of the federation-codegen design (rev 3). `securityCritical`.

## Why this exists

The hand-written data-model packages re-prove the same ~13-idiom guard inventory through multiple
rounds of adversarial review, and diverge (two different http(s)-IRI filters, one Turtle-injection
unsafe). This package **concentrates that discipline into one place audited once**. A generated model
(`model.d.ts` + `model.json` + `model.js`) is a fixed-template shim that inlines a pure-data manifest
and calls `defineModel` here — **generated artifacts contain no executable logic** (the data-not-code
invariant, design §7.1).

## The guard inventory (design §7.3)

Every read validates the original RDF term before projecting a JS value. Writes validate
the spelling they will store. The guard inventory is:

- **http(s)-only, injection-safe LEXICAL IRI filter** (`httpIriOrUndefined` / `isHttpIri`) — canonicalises
  via `URL.href`, then rejects any remaining Turtle IRIREF-forbidden character. Applied to IRI
  fields with `iriScheme: "http-https"` or the HTTPS-only `iriScheme: "https"` on read and write.
  Reads check shape-derived term kind, lexical length, pattern and enum membership before
  normalization. Enum IRIs keep their exact identity on reads and writes: scheme policy
  filters them without rewriting. Other admitted IRIs retain bookmark normalization.
  Canonicalisation retains the imported bookmark contract; unlike `rdf-serialize`, this helper
  rejects surviving forbidden characters rather than escaping the lexical input.
- **`tryRead` fail-closed field drops** — at the root, a malformed optional literal in untrusted
  pod data drops the field. Inside `sh:node`, a present violation makes the child non-conforming. Literal term kind, datatype, and XSD lexical forms are checked;
  malformed values cannot satisfy a required field.
- **Cardinality and enums** — ambiguous singletons drop; sets enforce `minCount`/`maxCount`.
  At the root, a `requiredFailClosed` failure rejects the record; an optional failure drops
  the field. Nested children validate all present values before projection.
  Closed `in` enums filter reads and writes, including live-set additions; invalid writes drop.
- **Singleton / default semantics** — `default`, `materializeDefault`, `defaultNow`, `emptyStringDrop`.
- **Control-char sanitization** on every untrusted text write (C0/C1 stripped; tab/newline/cr preserved).
- **One serialization boundary**, after alias migration: `serializeTurtle` checks every
  emitted term's kind and position, NamedNode and datatype IRI, Turtle blank-node label,
  BCP 47 language tag, prefix label and namespace immediately before `n3.Writer`.
  It then re-parses the buffered output with `n3.Parser` and verifies the same quad set,
  including lexical literal identity and a known blank-node bijection, in linear time.
  Invalid terms or a failed round trip throw `TypeError` and return no output; invalid prefix
  labels throw `ManifestError`. Public `types.add` also rejects unsafe IRIs before insertion.
- **Fail-closed manifest validation** — unknown keys rejected, hard caps on bytes / field count /
  `sh:in` length / nesting depth, reserved field-name denylist (`__proto__`, prototype members …),
  schema version bound to the runtime major. **No manifest field may ever carry executable, regex-source,
  template, or path-expression content.**

## API

```ts
import { defineModel } from "@jeswr/model-runtime";

const model = defineModel(manifest);            // validates fail-closed, then interprets
const bookmark = model.entities.Bookmark;       // one ModelEntity per manifest entity

bookmark.subject(resourceUrl);                  // conventional subject IRI (e.g. `${url}#it`)
bookmark.build(resourceUrl, data);              // -> n3 Store (writes through the guards)
bookmark.parse(resourceUrl, dataset);           // -> data object | undefined (fail-closed)
await bookmark.serialize(resourceUrl, data);    // -> Turtle
await bookmark.parseDocument(resourceUrl, body, contentType); // via @jeswr/fetch-rdf

new bookmark.Wrapper(subjectIri, store, factory); // direct typed accessor (extends TermWrapper)
```

`build` preserves the facade's non-validating write contract: missing/invalid required values
are dropped and may leave a typed shell. Call `parse(resourceUrl, builtStore)` and require a defined
result before publishing when MUST validation is needed. `serialize` uses the same build contract.

The manifest schema (`ModelManifest`) and `validateManifest` are exported for the generator and for
tooling. The IRI filters (`httpIriOrUndefined`, `isHttpIri`, `sanitizeText`, `tryRead`) are exported so
consumers migrating off a hand-written package keep the exact filter behaviour. Schema tooling
can use `readLiteral(term)` for strict RDF/JS datatype, lexical and value-space checks.

Decimal and integer reads reject precision loss: the input's canonical decimal spelling
must equal the plain decimal spelling produced after conversion to a JS number (ignoring
redundant signs and zeros). Admission uses the same reader for numeric bounds and enum
members, so `1.0000000000000001` cannot silently become `1`. Integer subtypes also retain
the safe-integer cap. Enum reads compare exact lexical forms and datatypes against the
runtime writer's canonical literals; admission rejects noncanonical enum members that a
value-only manifest cannot preserve (`"01"^^xsd:integer`, for example).

The XSD string family (`normalizedString`, `token`, `language`, `NMTOKEN`, `Name`, `NCName`,
`ID`, `IDREF`, `ENTITY` and their list types) has closed lexical checks on reads and writes.
Whitespace-normalizing types conservatively require normalized spelling; invalid lexical
forms drop without sanitization. Dates translate validated XSD years to ECMAScript syntax
on read, so expanded, negative and zero years round-trip within the JS Date range.

## Read-only IRI aliases

A flat entity or composite **node** may declare `aliasTypeIris: string[]`; a flat field
may declare `aliasPredicates: string[]`. Both keys are optional, contain at most four
**distinct, Turtle-safe absolute http(s) IRIs**, and exclude their canonical `typeIris` / `predicate`.
Predicate aliases cannot overlap any field's canonical predicate or another alias anywhere
in the manifest. If a canonical predicate is shared by multiple entities or nodes, none of
those owners may declare aliases for it: RDF co-typing prevents proving their focus sets disjoint.
`rdf:type` and nested link predicates are reserved from flat canonical
fields and all aliases. Type aliases cannot equal any canonical type or another owner's alias.
`nested` structural links reject `aliasPredicates`, even an empty array.
Aliases do not bypass the reserved-name or unknown-key checks.

- Singleton getters and `parse` apply the normal field guards to the canonical predicate
  first, then each alias **in array order**, stopping at the first defined value. `false`,
  `0`, and `""` win over aliases. Each predicate checks distinct raw terms and `maxCount`
  before strict mapping; ambiguity or a cardinality violation drops the field without alias
  fallback (and rejects a required record). Defaults apply only when **all** predicates are absent; invalid present
  values cannot be masked by defaults. Defaults never satisfy `requiredFailClosed` and never
  apply with `maxCount: 0`. Reads do not mutate the dataset.
- Sets read the guarded, deduplicated union (Dates compare by instant). Their mutations
  migrate surviving raw RDF terms to the canonical predicate and remove alias triples. Parse checks
  raw-union `maxCount` (including malformed terms) and guarded raw-term-union `minCount`,
  before deduplicating JS values. Required sets reject every invalid raw member.
- Type checks accept a subject's `rdf:type` reaching any canonical or alias class through
  `rdfs:subClassOf*` in the data graph. The cycle-safe walk shares a 10,000 raw-read budget
  across all accepted classes per check and fails closed on exhaustion. `mark()` removes
  explicit alias types, adds canonical types, and preserves subclass and unrelated types.
  Builds and setters write canonical predicates only; every setter, including `undefined`
  or an invalid value, clears all
  alias triples for its field.
- `serialize` and `storeToTurtle` migrate field/type aliases only where their owning shape
  applies. Roots must be recognised by their entity's canonical/alias types or data-graph
  subclasses; composite children must be reached through that entity's bounded, unambiguous
  links and satisfy any explicit link class. Migration determines all focus nodes from the
  original data before changing predicates or types. Unrelated subjects and unreached
  composite nodes retain their predicates and types, including known aliases.
  `storeToTurtle` works in a copy without mutating its input. Singleton migration retains the raw
  term selected by canonical-first reads; sets and live-set mutations retain every guarded
  raw term, including distinct terms with equal JS projections. Migration changes predicates
  without normalizing IRI spellings, literal lexical forms or datatypes, sanitizing retained
  text, or collapsing raw cardinality. Revalidation checks those original terms. Explicit API
  writes still apply JS write guards and sanitization. Prefixes advertising alias namespaces
  are omitted.

Before deleting an alias `rdf:type`, migration materialises each satisfied explicit link
`sh:class` on that subject, preserving proofs that depended on the deleted alias's data-graph
ancestry. It then re-parses every previously recognised entity/node projection (including
recognised but unreached nodes) and every reached child focus. Changed type recognition or
parsed results throw the exported `MigrationError` before any output is emitted. The check
shares a 10,000-read/visit budget across candidate scanning, class walks and re-parsing;
exhaustion also throws `MigrationError`. This includes rejecting cleanup that would repair
invalid required data or expose a previously masked default. The input store stays unchanged.

The generator derives aliases exclusively from explicit extra `sh:targetClass` values and
bounded `sh:alternativePath` lists. Vocabulary alignment annotations never grant aliases.

## Composite (document-projection) entities

A `kind: "composite"` entity models ONE flat object projected across SEVERAL connected RDF nodes of
one document — the shape the hand-written multi-node models (e.g. `@jeswr/solid-listening`'s
`ScrobbleData`, five nodes: a `media:PlaybackEvent #it` → a `media:Track #track` → `#artist`/`#album`,
plus a `time:Instant #playedAt`) carry. A composite is a **tree** of nodes: a `root` plus one sub-node
per `nested` link field. Each node has its own `rdf:type`(s), document `fragment`, and flat field set;
field names are **globally unique** across the composite (the projection is one object).

```jsonc
{
  "name": "Scrobble", "kind": "composite", "root": "event",
  "nodes": [
    { "name": "event", "typeIris": ["…#PlaybackEvent"], "fragment": "it", "fields": [
      { "name": "msPlayed", "predicate": "…#msPlayed", "kind": "literal", "datatype": "xsd:integer" },
      { "name": "playedWork", "predicate": "…#playedWork", "kind": "nested", "node": "track",
        "guards": { "requiredFailClosed": true } }        // a Violation-graded cross-node MUST
    ]},
    { "name": "track", "typeIris": ["…#Track"], "fragment": "track", "fields": [
      { "name": "trackTitle", "predicate": "dct:title", "kind": "literal", "datatype": "xsd:string",
        "guards": { "requiredFailClosed": true, "nonBlank": true } } ]}
  ]
}
```

- **`build`** writes every node at `${resourceUrl}#${fragment}` and links them (an optional sub-node
  is materialised only when its subtree carries data — no bare typed shells).
- **`parse`** GRAPH-WALKS from the root: it follows the ACTUAL link triple (never assumes the fragment
  — an untrusted document may link anywhere), requiring an absolute http(s) NamedNode without
  IRIREF-forbidden characters and bounding the candidate scan. It follows the exact linked term
  without URL canonicalisation. The root must have a data-graph type reaching one of its
  canonical or alias classes. A child validated through `sh:node` must satisfy its shape's
  property constraints; it need not carry the shape's target type. `sh:targetClass` selects
  focus nodes and does not add a child constraint. Inside a child, every present raw value
  must satisfy its property constraints, even for optional fields and optional deeper links.
  Absence is allowed when the property's minimum permits it. Nested conformance counts the
  raw path union before canonical-first projection; root reads retain their documented alias
  selection and drop-invalid-optional policy. Link-resolution
  enforces any retained `hasClass` (`sh:class`): the linked subject must have that type,
  or a type reaching it through `rdfs:subClassOf*` in the **data graph**. Build-time ontology
  ancestry never proves data membership. Traversal is cycle-safe and capped at 10,000 raw
  type/subclass reads per link; exceeding the cap fails the link closed. Builds explicitly
  assert the link's class on a materialised child so their data needs no ontology inference.
  Link-resolution failure — an absent or non-conforming target, an AMBIGUOUS link (>1 distinct target), an unsafe IRI, or an
  over-budget fan-out — at a root link is graded by that link: `requiredFailClosed` rejects the
  whole composite, while an optional link drops its subtree. Inside a child, a present failed
  link makes that child non-conforming; the failure propagates to its incoming link. Field
  names are globally unique, so conforming sub-nodes merge into one flat object.

The composite manifest enforces a tree: one root, exactly one incoming link per non-root
node, and no unreachable nodes or cycles. A `nested` field carries no scalar data-shape
keys and only the `requiredFailClosed` guard. It may retain a safe absolute `hasClass` IRI,
but cannot require a type alias owned anywhere in the manifest, because migration can delete
that assertion. `classOnly: true` represents `sh:class` without `sh:node`, requires `hasClass`,
and must project a node whose sole canonical target class equals `hasClass` exactly. Links
combining `sh:class` and `sh:node` retain their ontology compatibility check in the generator.
Composite documents are http(s)-scoped, matching the suite IRI discipline.

## Install

Workspace consumers depend on `workspace:*`. External consumers keep using
`github:jeswr/model-runtime#<sha>` pins, served by the mirror (`scripts/mirror-publish.mjs`).
`dist/` is built fresh in the workspace and never committed here.

## Development

```bash
pnpm turbo run lint build typecheck test --filter=@jeswr/model-runtime
```

## Licence

MIT © Jesse Wright
