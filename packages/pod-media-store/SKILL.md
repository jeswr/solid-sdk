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
- Copies are shared: content-named media serve every record that saved the same bytes. A journalled delete must not
  outlive that. `put` withdraws a copy's pending delete BEFORE any write on Solid (an adopted copy with a dead
  journal fails closed with no orphans; a fresh one succeeds); everything on one copy (`put`, `remove`, `update`,
  `attachThumbnail`, each `resumePending` entry, `withdrawPending`, each sweep candidate) runs under one per-store
  lock keyed by the canonical URL, which is released only when its queue drains (an aborted waiter never frees it).
  `resumePending` re-reads the journal entry before EACH destructive request, writes phase `deleted` right after
  the description delete, and takes `{ signal?, shouldResume? }`: the veto answers `true`, `false` or `"withdraw"`
  and any other store call on its copy fails with `conflict`/`reentrant`. `withdrawPending(url)` answers
  `withdrawn`, `none` or `incomplete`. `sweepOrphans` skips media a pending entry names and re-checks under the lock.
- Exposure fails closed: the probe must say `private` for the library and for the shard before a write;
  `unknown` refuses unless `allowUnknownExposureFor(containerUrl)` returns exactly `true` for that container;
  `exposed`, a missing probe, a throwing probe and a nonsense answer always refuse (the override is not even
  asked); a throwing or non-boolean override is `false`; the override is asked per refusal and never cached;
  only `private` is cached. Registration is private-index only.
- `ensureLibrary` finds or creates (private-index registration) the library without writing media and RETURNS the
  probe's answer for it (`{ url, created, exposure, probed }`), never refusing. It creates a missing library only
  when the storage root probes `private`, or `unknown` with `allowUnknownExposureFor(root)` exactly `true`; an
  exposed or unprobeable root creates nothing (`url: null`, `probed` is the root). It never writes an access rule.
  `put` is unchanged: it creates the library first and probes after, then fails closed.
- A conditional `update` write that the server answers with a CREATE (`created: true`, CSS does this for an
  `If-Match` on a deleted resource) is undone (conditional delete, best effort) and reported `not-found`.
- The caller's body is read EXACTLY ONCE (a `File` may answer later reads differently). Size, sniff head
  (`SNIFF_BYTES` = 4096, plus the declared extension as `hints.extension`) and SHA-256 come from that one buffer,
  and storage-client is given a fresh `Blob` built from it (also for a `Uint8Array`), so hashed bytes are sent
  bytes and `auth.fetch` replays it above 16 MiB. Never read the caller's `Blob` again, and never claim a
  `Blob` is immutable. A storage 413 is `too-large` / `payload-too-large`, a 507 `insufficient-storage`.
- `exposureFromOwnerOnly` rethrows a throwing or rejecting check (a failed probe, never overridable); only a
  completed "cannot tell" is `unknown`. Discovery cannot tell public-index from private-index registrations:
  the exposure probe of the discovered container is the control. `sweepOrphans` selects by hash name, not type.
- `.spz` accepts any gzip or `NGSP`-prefixed bytes as opaque data; the store never inflates it, a consumer must.
- The default sniffer never returns SVG, HTML or XML types and refuses bytes carrying markup in the first 512
  bytes; MP3 needs an ID3v2 header or two consecutive valid frames. PLY needs `ply` + newline and a `format`
  header line; SPZ (gzip or `NGSP` v4) only when the declared extension is `.spz`; both are reported as
  `application/octet-stream`. No glTF JSON, OBJ or FBX.

Test pattern: the storage-client memory pod in both `solid` and `lws` modes (`test/support.ts` has the harness,
fault injection `intercept`, `serverNames` for an LWS that picks its own names, and `withoutResponseEtags` for a
server such as CSS whose create responses carry no ETag). Run the put and remove suites under that wrapper too.
`tools/storage-conformance/integration/pod-media-store.test.ts` is the opt-in real-CSS lane (`test:media-store`);
re-run it after changing any storage call or status handling. `src/review.test.ts` holds the regressions for the independent review; mutate the adoption checks, the
conditional-write validators, the containment and delete-scope checks and the exposure gate after edits and
confirm tests fail.
