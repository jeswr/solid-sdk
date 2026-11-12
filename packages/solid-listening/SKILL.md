---
name: solid-listening
description: Use when reading or writing Solid listening-history scrobbles through @jeswr/solid-listening, changing its codegen inputs or SHACL, regenerating its model core, or maintaining its facade over the generated media-sector composite.
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

`addScrobble` writes one scrobble at caller-chosen subjects (many per document): it runs
the generated composite build in a scratch store and moves the quads onto the caller's
subjects with `@rdfjs/wrapper`. Never write generated views directly into a large target:
every generated write rescans its whole dataset against the runtime's 10,000-read
migration budget. A written subject may pre-exist only with an identical description
(shared recording nodes). `src/add-scrobble.test.ts` pins equality with the composite
build, sharing, and 1,000 calls into one store.

Parse behaviour: required links (`playedWork`, `atTime`) and the track title fail
closed on any non-conforming value (a language-tagged title rejects the scrobble; README
"Exact divergences" lists the changes from the July package). The links are `sh:class`-only, so an optional problem on a child (two artists,
two albums, a malformed optional value) drops only that field.

From the workspace root:

```sh
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-listening run codegen
```

For a deliberate input change, review the diff and pass `--update-lock`. The drift test
`test/codegen.test.ts` must stay green; `pnpm run check:codegen` enforces that it exists.
