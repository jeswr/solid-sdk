---
name: site-model
description: Use when reading, writing or changing semantic agent browser site models (operations, flows, login routes as schema.org actions mapped to a site's own HTTP calls), the site-action (sab) vocabulary or shapes, planner action requests, the planner catalogue, or @jeswr/site-model's generated model.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/site-model

Read README.md first. Private ESM package, Node >=24. `src/types.ts` is the contract shared
with `@jeswr/site-profiler` and `@jeswr/site-executor`: do not change it without agreeing the
change with both lanes.

## API

- `readSiteModel(input, { baseIRI?, format? })`: Turtle-family text, the JSON-LD subset or
  quads to a `SiteModel`. Exactly one `sab:SiteModel`; blank nodes (not list cells) become
  `urn:x-site-model:genid:<n>`; http schema.org IRIs become https. Throws `SiteModelError`.
- `writeSiteModel(model)`: Turtle via `n3.Writer`. It reads its own output back and throws
  when the result differs from `canonicalSiteModel(model)`, so a successful write is lossless.
- `parseActionRequest(text, { format?, baseIRI? })`: the single schema.org `*Action` node;
  `values(path)` returns lexical values, IRIs, and `_:label` for blank nodes.
- `renderCatalogue(model)`: one line per flow then operation; no URLs, templates, CSRF or
  session details. Keep it that way: the planner must never see them.
- `validateSiteModel(model)`: `{ path, message }[]`; `$stepN` counts steps from 0.

## Rules

- Never hand-build Turtle. Nodes are written through `src/generated/model.js` entities
  (`build`) and read through them (`parse`); only `sab:valuePath` and `sab:option` (RDF lists)
  go through `@rdfjs/wrapper` in `src/lists.ts`.
- Vocabulary changes touch three files together: `site-action.ttl` (ontology, codegen input),
  `site-action.shacl.ttl` (normative shapes) and `codegen/site-action.codegen.shacl.ttl` (the
  narrowed profile; its header lists every narrowing). Then `pnpm run codegen --update-lock`,
  and update the README vocabulary table and "Generator gaps".
- Never edit `src/generated/` by hand; `test/codegen.test.ts` regenerates it byte for byte.
- Runtime-reserved field names (`value`, `datatype`, `id`, `types`, ...) cannot be shape
  names; use `sh:name` to rename (`propertyValue`, `valueDatatype`).
- Decimal properties need decimal literals: `sab:confidence 1` (an integer) is rejected.
- Fictional data only in tests (shop.test, Alex Example).

## Agent persona

None specific; use the general persona for suite packages.

Execution receipts admit sab:Completed, sab:Failed and sab:Uncertain. Uncertain means a write
may have reached the site without a 4xx rejection but execution did not finish; the host must retain and guard those effects.
Failed/Uncertain receipts may omit payment fields. Keep ontology, normative shapes and codegen
profile synchronized, regenerate via codegen and keep the byte-for-byte drift test passing.
The executor locally extends the shared ActionOutcome with uncertain; do not alter src/types.ts.

Use actionRequestTerms(request, path) when resolving inputs so RDF NamedNode, BlankNode and Literal
kinds survive until validation. The shared ActionRequest type and lexical values() API stay unchanged.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

List/write learning additions: keep totalPath synchronized through types, ontology, both shapes,
codegen config and generated artifacts (regenerate, never hand-edit). List counts are integers
on ItemList; unseen records make observations partial. Display coercion requires a row currency
code for formatted prices and strict ISO-like timestamp syntax; payment evidence rules stay
unchanged. Type records from endpoint-owned words, ignoring user query values. Refund documents
fall back to Thing/additionalType text rather than Invoice/category.

Composite write templates must be witnessed by successful demonstrations, size bounded and
redacted. Prefer witnessed cookie CSRF over hidden/meta sources; script variables require a
contract discussion, never a hard-coded token. Preserve ordinary flat-form defaults/options.
Created identities may come from checked on-origin 301/302/303 redirects and supply later flow
bindings. Keep every write approval and repeat guard; never replay POST while following redirects.
The harness's opt-in live test creates and cleans up only its own product, blocks background
preference writes and uses a scripted planner. Never invoke a planner/model CLI for acceptance.
