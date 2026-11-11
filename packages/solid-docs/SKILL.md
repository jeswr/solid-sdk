---
name: solid-docs
description: Use when reading or writing Solid Docs document, revision, comment or version RDF through @jeswr/solid-docs, maintaining its facade and legacy aliases, or regenerating its model.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Solid Docs generated model

The ontology, SHACL profile and config in `codegen/` generate `src/generated/` through
`@jeswr/federation-codegen`, interpreted by `@jeswr/model-runtime`. Never edit generated
files. Read those packages' skills before changing generation inputs. Run
`pnpm --filter @jeswr/solid-docs run codegen --update-lock` after changing inputs, and
retain the byte-for-byte drift test. Biome excludes `!!src/generated`.

`src/document.ts` composes the generated Document/Revision models and preserves revision
retention, bigint identity allocation, defaults and validation errors. Generated aliases
cover document type/container links/word counts. Only shared body/format legacy aliases
need a typed bridge (`src/views.ts`): closed admission rejects aliases on canonical
predicates shared by two owners. Keep it minimal and keep canonical writes.

Comments parse through generated Annotation/Quote MUSTs and enums; the facade checks
motivation-dependent anchors, UTF-16 bounds (sh:maxLength is unsupported) and context truncation. Version metadata uses generated Revision fields without `mark()`.
Do not add types to historically untyped target/version nodes. Versions retain a
mapper preflight check: a mistyped optional creator rejects the whole entry,
whereas generated root optional fields normally drop such a field. Type Index views
stay in the Suite app until it moves onto `@jeswr/pod-type-index` (bead sst-5wzk);
do not copy them into this package. Network, ETag, access checks, React and Yjs logic
belong in the app. Keep constants derived from `@jeswr/suite-vocab` and all stored IRIs.

Preserve the copied oracle tests verbatim except imports. Every behavior change must
have a `test/compatibility.test.ts` pin and a README `Exact divergences` entry. Run the
package and Suite app gate plus `pnpm run lint:root`. No new external dependencies or
runtime/generator changes are needed for this model.
