---
name: solid-memory
description: Use when maintaining @jeswr/solid-memory, its Solid store, scope compatibility, or container listing behavior.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Solid memory store

Use `MemoryStore` for memory CRUD and search; retain its tombstone and conditional-write
semantics. `list()` delegates HTTP/RDF listing work to `@jeswr/ldp-container` and returns
an empty array on 404/410. Its `ContainerMember` type remains exported from the root and
`/store`. The local compatibility scope delegate retains absolute-target and strict-resource
defaults, including slashless root-alias refusal. The local request wrapper refuses every
3xx and opaque redirect. Do not replace it with a weaker redirect policy.
