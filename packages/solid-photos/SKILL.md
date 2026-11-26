---
name: solid-photos
description: Use when reading or writing photographs, videos, EXIF, ordered photo albums or trash provenance through @jeswr/solid-photos, or regenerating its model and maintaining the Suite photos compatibility facade.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Codex GPT-6.2-Astra -->

# Solid photos model

The domain model is generated from the ontology, SHACL and config in `codegen/`.
Read the federation-codegen and model-runtime package skills before changing those
inputs. Never edit `src/generated/` or the generator/runtime packages for a photos
change. Regenerate with `pnpm --filter @jeswr/solid-photos run codegen --update-lock`
and run the byte-for-byte drift test. Biome must continue excluding `!!src/generated`.

Use `buildPhoto`/`parsePhoto`, `buildAlbum`/`parseAlbum`, `buildTrash`/`parseTrash`
and `serializePhotos`. The facades preserve the original app's IRIs, subject
fragments, EXIF normalization, ordered membership and trash state validation.
Vocabulary constants already owned by `@jeswr/suite-vocab` are imported from it.
`schema:ImageObject` has its own generated read projection. New stills use
`schema:Photograph`. Set `Photo.kind` to `"video"` for `schema:VideoObject`.
The video reader skips subjects without a usable content URL.

Use `durationSeconds` on `Photo` or `PhotographDoc`. The generated projections
validate the `schema:duration` datatype. The facade's `parseDuration` restricts
it to fixed-length days, hours, minutes and seconds, and `formatDuration`
writes seconds only. The media sector's CreativeWork/Track decimal duration
constraints remain outside this profile.

`src/views.ts` contains only generated-wrapper adapters and minimal typed views
for generator gaps: blank-node references/subjects, repeated ListItem children,
and the numeric datatype union on imported coordinates. Keep these inside this
package. Named fields/new writes use generated accessors; never hand-build triples.
`README.md` documents every profile omission and divergence. Preserve the copied
model oracle tests unchanged except import paths, and pin any new behavior change
in `test/compatibility.test.ts` and the README's Exact divergences section.

The Suite app keeps I/O, upload/image processing, timeline grouping and trash
orchestration. Its old model modules re-export this package for existing consumers.
Do not move React, network or storage orchestration into the model package.

Use Node 24. Run the package and Suite lint/build/typecheck/test Turbo gate, plus
`pnpm run lint:root`; the Suite suite includes coverage thresholds and can take
more than ten minutes. `dist/` is built fresh and never committed.
