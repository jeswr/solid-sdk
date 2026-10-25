<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Historical package availability note

The detailed snapshot predates the workspace package. This source passage is retained
for completeness; the [package skill](../../../packages/solid-offline/SKILL.md) governs
the current API. The snapshot caching pattern remains in the parent skill.

This is an **app-level interim pattern** (a `localStorage`/`IndexedDB` snapshot of the
render-shaped data). The suite's eventual home for offline reads is a **service-worker
read-through cache** that intercepts the pod `fetch`es and serves cached bytes directly, with
**`WebSocketChannel2023` invalidation** (the `solid-notifications` skill) to drop stale entries —
the [`jeswr/solid-offline`](../../../packages/solid-offline/README.md) package. Until that layer is
wired into an app, hold the snapshot cache yourself as below. (Do **not** write code against a
`solid-offline` API here — it is not yet published; this skill documents the *pattern*, not a
package surface.)

