---
name: model-runtime
description: Use when loading a generated domain model (model.js from @jeswr/federation-codegen), calling defineModel on a shape-manifest, reading or writing pod RDF through generated entities, or changing the audited guard set in @jeswr/model-runtime.
---
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# Generated-model runtime

`@jeswr/model-runtime` lives in `packages/model-runtime` and is security-critical. It is the
one interpreter for every generated domain model: a generated `model.js` inlines a JSON
shape-manifest and calls `defineModel(manifest)`; all behaviour lives here.

```ts
import model, { entities } from "./generated/model.js"; // emitted by federation-codegen

const bookmark = entities.Bookmark;
const store = bookmark.build(resourceUrl, { url: "https://example.org/a" }); // n3 Store
const data = bookmark.parse(resourceUrl, dataset);      // object | undefined (fail-closed)
const ttl = await bookmark.serialize(resourceUrl, data); // n3.Writer Turtle
const parsed = await bookmark.parseDocument(resourceUrl, body, contentType); // via @jeswr/fetch-rdf
const w = new bookmark.Wrapper(bookmark.subject(resourceUrl), store, DataFactory);
```

## Rules

- Never hand-write a manifest for production use. Manifests come from `federation-codegen`,
  whose fidelity assertion proves every field traces to `shapes.ttl` or the committed config.
- Keep generated artifacts data-only. A manifest must never carry code, regex source,
  templates or path expressions; `validateManifest` rejects unknown keys and enforces caps.
- Every IRI field with `iriScheme: "http-https"` or `iriScheme: "https"` goes through `httpIriOrUndefined` on read
  and write. Do not add a bypass; widen schemes only with a new reviewed guard.
- A Violation-graded MUST (`requiredFailClosed`) rejects the whole record on parse when
  missing, malformed, ambiguous, or outside its set cardinality bounds. Optional fields drop.
- build does not enforce requiredFailClosed: missing or invalid values are dropped and a
  typed shell may be returned. This preserves the bookmark facade's write contract. Parse
  the built store and require a defined result before publishing it if MUST validation is needed.
- Closed `in` enums are enforced on reads, build, setters and live-set adds. Invalid enum
  values drop, consistently with other invalid writes; they do not throw.
- Read aliases are optional `aliasTypeIris` on flat entities/composite nodes and ordered
  `aliasPredicates` on flat fields (at most four distinct, Turtle-safe absolute http(s) IRIs per key).
  They exclude canonical IRIs; predicate aliases cannot overlap any canonical/alias
  predicate across the manifest. `nested` links reject aliases, including empty arrays.
- Singleton reads guard the canonical value first, then aliases in order; only `undefined`
  falls back (`false`, `0`, and `""` win). Defaults require all predicates to be absent.
  Each predicate checks distinct raw terms and maxCount before mapping: ambiguity or a
  cardinality violation drops the field without alias fallback; a required field rejects.
  Sets expose the guarded union; parse checks raw-union maxCount and guarded-union minCount.
  Reads never mutate. Set mutations migrate retained
  members. Setters clear aliases even on `undefined`/invalid input; `mark` clears alias
  types. Serialisation migrates known aliases in a copy and writes canonical IRIs only.
- Composite entities graph-walk exact link terms from the root; never assume fragments.
  A linked IRI must already equal its safe http(s) canonical form; otherwise the required
  link rejects the record and an optional link drops its subtree.
- Domain policy the schema cannot express (network fetches, SSRF policy, reconciliation)
  belongs in the consuming package's facade, not in this runtime.
- Changes here are security-critical: add an adversarial test that fails before the fix.

## Exports

`defineModel`, `validateManifest`, `ManifestError`, `MANIFEST_VERSION`, `RUNTIME_MAJOR`,
manifest types, and the shared guards `httpIriOrUndefined`, `isHttpIri`, `sanitizeText`,
`tryRead` plus the XSD datatype mappers. Packages migrating off hand-written models may reuse
the guards so their filter behaviour stays byte-identical.
