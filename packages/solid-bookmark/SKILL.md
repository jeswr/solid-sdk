---
name: solid-bookmark
description: Use when reading or writing Solid bookmarks through @jeswr/solid-bookmark, changing its ontology or SHACL, regenerating its model core, or maintaining its public facade and legacy namespace compatibility.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Solid bookmark model

The hand-written [ontology](./bookmark.ttl) and [SHACL](./bookmark.shacl.ttl) are the source
of truth. [codegen.config.json](./codegen.config.json) supplies policy that SHACL cannot
express: `#it` subjects, false archived defaults, creation timestamps, empty text drops,
and trimmed/sorted tags. The generated manifest, JS/declarations, normalized shapes,
and hashes live in `src/generated/`; never edit them directly.

`parseBookmark`/`parseBookmarkTtl` validate through the SHACL profile, then carry any field
the profile omits (language-tagged or non-string text, an `xsd:date` created value, extra
titles) using the hand-written package's read, so a parse → edit → serialize round-trip
keeps those values. The `Bookmark` wrapper getters follow the profile exactly; set fields
through it on the original Store to keep the original terms (language tags, datatypes)
too. Relative resource URLs throw. README "Exact divergences" lists every case.

From the workspace root, build the generator/dependencies, then regenerate:

```sh
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-bookmark run codegen
```

For a deliberate input change, review the ontology/SHACL/config diff and pass
`--update-lock` to the codegen command. Run
`pnpm exec turbo run lint build typecheck test --filter=...@jeswr/solid-bookmark`.
The regeneration test compares all six artifacts byte for byte, including the lock.
The 78 original `src/*.test.ts` tests are the oracle; preserve them unchanged during
generated-core migrations. `dist/` is built fresh and never committed.

Keep the [facade](./src/bookmark.ts) at most 150 lines. Field access, IRI guards, aliases,
and RDF parsing belong to `@jeswr/model-runtime`. The facade preserves original Store,
property, and plain-data JSON field order and the shared `@jeswr/rdf-serialize` serializer's bytes;
it does not migrate arbitrary Stores' legacy triples during serialization. The public `Bookmark`
class adds `isBookmark` and preserves the boolean `archived` getter/clearing setter.
`vocab.ts` stays hand-written. The root and `/vocab` entries are browser-safe;
filesystem readers belong exclusively to the Node-only `/shape` entry, which continues
to read the normative package-root TTL files. Preserve all exports and TTL subpaths.

Readers accept canonical and legacy bookmark types/notes/archived predicates. Reads
prefer canonical values; setters clear aliases and write canonical IRIs. Alias policy
comes from SHACL, never facade string matching. Use typed wrapper accessors and the
runtime; no hand-built triples or LDO. Consult the package-local model-runtime and
federation-codegen skills before changing generation or guard behavior.

The `tsc` build copies the generated JS and precise declarations into `dist/generated/`.
The mirror must retain `@jeswr/model-runtime` and receive a `--dep-sha` pin for its
`jeswr/model-runtime` mirror; declarations import runtime types, so it cannot be listed
under `mirrorPublish.inlined`. The generator remains build-time only.
