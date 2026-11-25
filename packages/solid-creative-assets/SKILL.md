---
name: solid-creative-assets
description: Use when reading or writing AI-generated creative assets (images, video, 3D models, project documents, collections) and their PROV-O generation provenance on a Solid pod through @jeswr/solid-creative-assets, changing its SHACL profile or codegen config, regenerating src/generated, or extending the facade.
---
<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# Solid creative assets

The SHACL profile ([creative-assets.shacl.ttl](./creative-assets.shacl.ttl)), the ontology
input ([creative-assets.ttl](./creative-assets.ttl)) and
[codegen.config.json](./codegen.config.json) are the source of truth. `src/generated/` is
compiled from them by `@jeswr/federation-codegen`; never edit it. After an intentional input
change run `pnpm --filter @jeswr/solid-creative-assets run codegen --update-lock` and review the
diff. The drift test and root `check:codegen` fail on a stale generated directory.

Use the facade, never triples:

- `buildAssetDocument` / `parseAssetDocument` / `serializeAssetDocument` / `parseAssetDocumentTtl`
  for an image, video or 3D asset with its optional thumbnail and generation (run, prompt,
  model, settings).
- `buildProjectDocument`, `buildCollection` and their `parse…` / `serialize…` forms.
- `documentUrl(url)` is absolute with no fragment; the asset is `<doc#it>`, the other nodes are
  `#run`, `#prompt`, `#model`, `#thumbnail`, `#setting-<n>`. Links outside the document are
  never followed.

Rules that bite:

- Only `https://schema.org/` and `http://www.w3.org/ns/prov#` are written. Legacy
  `http://schema.org/` **classes** are read; legacy **predicates** are not (generator gap).
- Seeds and every setting value are strings. Dates are `xsd:dateTime` (SHACL `xsd:date` would
  fail validation). Width and height are integers.
- Writes throw `TypeError` for a missing or non-http(s) `contentUrl` rather than writing a
  typed shell; reads return `undefined` for such documents and skip optional malformed fields.
- Adding a field means editing the SHACL profile (and ontology label/definition), then
  regenerating. The README "Generator gaps" lists what the generator cannot express; do not
  hand-write accessors around them, file or extend the generator.
