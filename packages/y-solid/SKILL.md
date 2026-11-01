---
name: y-solid
description: Use when maintaining @jeswr/y-solid, its Solid store, scope compatibility, or container listing behavior.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Yjs update log persistence

Keep the append-only binary update log and write-before-delete compaction ordering.
`SolidUpdateStore.listUpdateUrls()` parses RDF with `@jeswr/fetch-rdf` after its capped
streaming read, then uses `@jeswr/ldp-container`'s `parseContainerMembers`. It skips
sub-containers and sorts URLs locally. Preserve listing/update byte caps, all-3xx/opaque
redirect refusal, and canonical checked values for resource requests. Scope guards come
directly from `@jeswr/guarded-fetch`; the existing public re-exports stay compatible.
