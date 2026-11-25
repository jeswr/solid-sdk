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
- Never derive a URL from container plus name after a create. Use the returned URL. Finding an existing
  Solid name reads the shard listing (`findChild`).
- Every outcome is a `Result` with the closed error union. Messages, URLs with queries and credentials never
  appear in an error. An abort is `failed` / `aborted` and outranks other errors.
- "Already exists" is success only after the existing bytes hash to the expected value and the existing
  description parses and `locate`s that binary. Never overwrite what was found.
- Compensation deletes only resources created by the same call, conditionally on the create response's ETag, and
  never a binary or thumbnail while a description holds the content name (review D1). It ignores the caller's abort.
- Media URLs from a parsed description are trusted only inside a shard of the library (`shardOfMember`). On Solid
  that is a path check; on LWS identifiers are opaque, so containment is proven with `storage.parentOf` or by
  having listed or created the resource this session.
- The journal and the type index are untrusted input. `resumePending` deletes only inside a library shard.
- The default sniffer never returns SVG, HTML or XML types and refuses a media header that carries markup.

Test pattern: the storage-client memory pod in both `solid` and `lws` modes (`test/support.ts` has the harness,
fault injection `intercept`, and `serverNames` for an LWS that picks its own names). Mutate the "already exists"
checks and the compensation ETag logic after edits and confirm tests fail (`src/adversarial.test.ts`).
