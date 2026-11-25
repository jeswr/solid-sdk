---
name: pod-media-store
description: Use when storing, listing, editing or deleting a binary plus its RDF description document in a Solid or LWS pod with @jeswr/pod-media-store, wiring its parse/build/locate callbacks, exposure check or delete journal, or maintaining this package.
---
<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# @jeswr/pod-media-store

Read README.md before changing this package. It is security critical: keep 100% statement, branch,
function and line coverage (`vitest.config.ts` enforces it) and never auto-merge.

Rules that must survive any change:

- Storage I/O only through the public `StorageClient` (`createPodClient`); discovery only through
  `@jeswr/pod-type-index`. No raw `fetch`, no quads, no regex over Turtle, no ACL writes. The caller injects
  `parse`, `build` and `locate`; if something needs RDF in `src`, stop and extend the caller's model instead.
- Use the URL a create returned, except where the name is exact (Solid) and the URL is known before the create:
  the description at `<shard>/<hash>`, created atomically with its whole body. Never leave an empty description on
  Solid. On LWS the empty shell is filled with a write conditional on its own validator, never on `*`.
- Never delete media on a failed put (no compensation): media are content-named, so retries adopt them. The only
  thing a failed put removes is an empty LWS shell it made itself, and only while still empty. `sweepOrphans`
  (age-gated, shard left alone when any description is unreadable) is the cleanup.
- Every outcome is a `Result` with the closed error union. Messages, URLs with queries and credentials never
  appear in an error. An abort is `failed` / `aborted` and outranks other errors. No operation throws.
- "Already exists" is success only after the existing bytes hash to the expected value and the existing
  description parses and `locate`s that binary. Never overwrite what was found.
- `remove` and `resumePending` delete the description first (conditional on its ETag, still locating the recorded
  binary), and media only after it is confirmed gone and not recreated. Media deletes are limited to the item's own
  shard, never a description-typed resource, never dot names, and on Solid only `<description name>[-thumb].<ext>`.
- `update` may not change which binary or thumbnail a description locates; `attachThumbnail` is the one way to add one.
- Media URLs from a parsed description are trusted only inside a shard of the library (`shardOfMember`). On Solid
  that is a path check; on LWS identifiers are opaque, so containment is proven with `storage.parentOf` or by
  having listed or created the resource this session.
- The journal, cursor, type index and descriptions are untrusted input. `resumePending` acts only inside the library.
- Exposure fails closed: the probe must say `private` for the library and for the shard before a write;
  `unknown` refuses unless `allowUnknownExposureFor(containerUrl)` returns exactly `true` for that container;
  `exposed`, a missing probe, a throwing probe and a nonsense answer always refuse (the override is not even
  asked); a throwing or non-boolean override is `false`; the override is asked per refusal and never cached;
  only `private` is cached. Registration is private-index only.
- A `Blob` body is handed to storage-client as the caller's own instance, never converted to bytes. Hashing
  reads it into one transient buffer (WebCrypto has no streaming digest); sniffing gets only the first
  `SNIFF_BYTES` (4096) bytes plus the declared extension as `hints.extension`. Keep it that way: a copy would
  hit `auth.fetch`'s 16 MiB replay limit.
- The default sniffer never returns SVG, HTML or XML types and refuses bytes carrying markup in the first 512
  bytes; MP3 needs an ID3v2 header or two consecutive valid frames. PLY needs `ply` + newline and a `format`
  header line; SPZ (gzip or `NGSP` v4) only when the declared extension is `.spz`; both are reported as
  `application/octet-stream`. No glTF JSON, OBJ or FBX.

Test pattern: the storage-client memory pod in both `solid` and `lws` modes (`test/support.ts` has the harness,
fault injection `intercept`, `serverNames` for an LWS that picks its own names, and `withoutResponseEtags` for a
server such as CSS whose create responses carry no ETag). Run the put and remove suites under that wrapper too.
`src/review.test.ts` holds the regressions for the independent review; mutate the adoption checks, the
conditional-write validators, the containment and delete-scope checks and the exposure gate after edits and
confirm tests fail.
