---
name: solid-drawing
description: Use when reading or writing scenes through @jeswr/solid-drawing, changing its drawing profile, regenerating its model, or maintaining its facade and legacy namespace compatibility.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Solid drawing model

The scene model is generated from [codegen/](./codegen/). All nine fields build/parse
through `entities.Scene` in `src/generated/model.js`, interpreted by
`@jeswr/model-runtime`. [src/scene.ts](./src/scene.ts) preserves the public function API
and `SceneData`'s string timestamps. A scene links an opaque byte-exact canvas JSON
resource; it never models canvas elements as RDF.

Read the [profile header](./codegen/drawing.shapes.ttl) before changing constraints:
it records the package/sector vocabulary differences, optional title, added fields,
legacy aliases and narrowed literal datatypes. The published [drawing.ttl](./drawing.ttl)
and [drawing.shacl.ttl](./drawing.shacl.ttl) remain separate, unchanged artifacts exposed
by their TTL subpaths and the Node-only `/shape` entry. Keep filesystem imports off the
root entrypoint.

The facade owns these compatibility policies:

- Keep [iri.ts](./src/iri.ts)'s lexical escaping and its unchanged differential oracle.
  Required subjects/canvas links throw for invalid writes; optional invalid IRIs drop.
  Avoid generated `iriScheme` normalization: RDF identity must remain lexical.
- Singleton checks count both aliases, including invalid raw values. The runtime alone
  is canonical-first, so retain the facade's check using generated alias metadata.
- Version/background accept arbitrary literal text in the published model. Admission
  requires concrete datatypes, so generate `xsd:string` and carry other literals with
  the minimal typed lexical view. Never let a non-literal or conflicting alias through.
- Convert timestamp strings with the runtime's strict XSD reader/writer; generated fields
  use `Date`. Preserve expanded/negative-year XSD spelling during the conversion.
- The config preserves text exactly (`sanitizeText: false`). Generic `storeToTurtle`
  preserves unrelated/legacy terms through rdf-serialize; `serializeScene` delegates
  to the generated serializer.

[README Exact divergences](./README.md#exact-divergences) and
[test/compatibility.test.ts](./test/compatibility.test.ts) pin all changed behavior.
The original 90 `src/*.test.ts` tests are the unchanged oracle. Do not hand-edit
`src/generated/`; change the inputs and regenerate instead:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-drawing run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=...@jeswr/solid-drawing
node scripts/check-codegen.mjs
```

The drift test compares every generated file, including the lock, byte-for-byte.
The build copies generated JS/declarations into `dist/generated/`; `dist/` is not
committed. Runtime remains a non-inlined workspace dependency; generator stays a
workspace devDependency. Consult the package-local federation-codegen/model-runtime
skills for admission and guard details.
