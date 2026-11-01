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

Every read/write goes through, in the load-bearing order:

- **http(s)-only, injection-safe LEXICAL IRI filter** (`httpIriOrUndefined` / `isHttpIri`) — canonicalises
  via `URL.href`, then rejects any remaining Turtle IRIREF-forbidden character. Applied to IRI
  fields with `iriScheme: "http-https"` or the HTTPS-only `iriScheme: "https"` on read and write.
  Canonicalisation retains the imported bookmark contract; unlike `rdf-serialize`, this helper
  rejects surviving forbidden characters rather than escaping the lexical input.
- **`tryRead` fail-closed field drops** — a malformed literal in untrusted pod data drops the field
  rather than aborting the parse. Literal term kind, datatype, and XSD lexical forms are checked;
  malformed values cannot satisfy a required field.
- **Cardinality and enums** — ambiguous singletons drop; sets enforce `minCount`/`maxCount`.
  A `requiredFailClosed` failure rejects the record; an optional failure drops the field.
  Closed `in` enums filter reads and writes, including live-set additions; invalid writes drop.
- **Singleton / default semantics** — `default`, `materializeDefault`, `defaultNow`, `emptyStringDrop`.
- **Control-char sanitization** on every untrusted text write (C0/C1 stripped; tab/newline/cr preserved).
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
consumers migrating off a hand-written package keep the exact filter behaviour.

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
  — an untrusted document may link anywhere), requiring each lexical target to already equal its
  safe http(s) canonical form and bounding the candidate scan. A sub-node must carry its `rdf:type` (fail-closed). Link-resolution
  failure — an absent or non-conforming target, an AMBIGUOUS link (>1 distinct target), a noncanonical IRI, or an
  over-budget fan-out — is graded by the link: a `requiredFailClosed` cross-node link **rejects the
  WHOLE composite** (a titled `Track` + a valid `Instant` MUST be reachable); a Warning/Info (optional)
  link simply drops its sub-node's fields and admits (an otherwise-usable document is never rejected
  over an unresolvable optional link). Field names being globally unique, the sub-nodes' fields merge
  into one flat object.

The composite manifest is validated **fail-closed** (the tree invariant — one root, every non-root node
exactly one incoming link, acyclic + spanning; a `nested` field carries no data-shape key and only the
`requiredFailClosed` guard; composite documents are http(s)-scoped, matching the suite IRI discipline).

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
