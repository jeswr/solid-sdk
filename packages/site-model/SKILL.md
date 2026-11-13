---
name: site-model
description: Use when reading, writing or changing semantic agent browser site models (operations, flows, login routes as schema.org actions mapped to a site's own HTTP calls), the site-action (sab) vocabulary or shapes, planner action requests, the planner catalogue, or @jeswr/site-model's generated model.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

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
