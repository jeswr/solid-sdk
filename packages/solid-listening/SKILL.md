---
name: solid-listening
description: Use when reading or writing Solid listening-history scrobbles through @jeswr/solid-listening, writing Suite Music library or history data through its library facade, changing its codegen inputs or SHACL, regenerating its model core, or maintaining its facades over the generated media-sector entities.
---
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Solid listening-history model

A scrobble is a five-node composite from the media sector: `#it` (`media:PlaybackEvent`),
`#track` (`media:Track`), `#playedAt` (`time:Instant`), `#artist` and `#album`. It mints
no IRIs. `src/scrobble.ts` is a thin facade over the generated core in `src/generated/`,
which `@jeswr/model-runtime` interprets; `iri.ts`, `acl.ts`, `vocab.ts`, `nodes.ts` and
`shape.ts` stay hand-written. Never edit `src/generated/` directly.

Generation inputs live in `codegen/`: the media ontology subset, the scrobble shapes
subset and `codegen.config.json` (fragments, renames, links). The shapes subset leaves
out the ISRC pattern and `media:playedVia`, and narrows `playedWork` to `media:Track`;
the reasons are in its header. `listening.shacl.ttl` is the published, complete profile
validated in `src/shape.test.ts`.

Parse behaviour: required links (`playedWork`, `atTime`) and the track title fail
closed on any non-conforming value (a language-tagged title rejects the scrobble; README
"Exact divergences" lists the changes from the July package). The links are `sh:class`-only, so an optional problem on a child (two artists,
two albums, a malformed optional value) drops only that field.

The Suite Music library (`src/library.ts`) adds five flat entities (`LibraryTrack`,
`LibraryArtist`, `LibraryAlbum`, `LibraryPlaylist`, `Listen`) under the jeswr.org sector
namespace the app writes, and reuses the composite's `playedAt` node for instants.
`libraryTypeQuads` stamps the sector class plus its schema.org co-type;
`libraryFieldQuads` returns one field's quads from a scratch store (merge them into the
live dataset after clearing the field) and throws `RangeError` when the model rejects a
value. Do not write through wrappers on a large live dataset: each write re-checks alias
migration over every typed subject under a 10,000-read budget. Tolerant foreign reads,
playlist ListItems, instant allocation and `msPlayed` writes stay in the app (README
"Suite Music library").

From the workspace root:

```sh
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-listening run codegen
```

For a deliberate input change, review the diff and pass `--update-lock`. The drift test
`test/codegen.test.ts` must stay green; `pnpm run check:codegen` enforces that it exists.
