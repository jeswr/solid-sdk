---
name: pod-notifications
description: Work on @jeswr/pod-notifications, storage-scoped change normalisation, subscription state and polling across Solid and LWS.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-notifications

T-040 implements the ADR-005 contracts, `createNotifications`, internal `createChangeNormalizer`,
subscription lifecycle/async iteration, `./channels/poll`, and `./testing` fakes.
Push channel subpaths remain scaffolds for T-041/T-042. `plan()` reports advertised transport
preference; this cut always runs the polling fallback. The subscription's `channel` is the
actual transport. Keep that temporary distinction explicit in the README until push lands.

Use only the storage-client public API (`features`, `head`, `listAll`, `isWithinStorage`).
All topics/hot resources must be scoped. Poll serially, establish a quiet baseline, and commit
container snapshots only after all listing pages succeed. Missing ETags are not changes.
Containers cover direct membership; hot resources observe individual edits. Offline pauses
and aborts work; online immediately reconciles. Forbidden closes; transient failures retry.
Close must release timers/listeners and settle pending iterators even when observers fail.
`SubscriptionController` and `runtime.ts` are internal seams for the later push tasks; maintain
terminal closed state and idempotent cleanup. Do not run polling and push for the same topic.

Normalisation takes a canonical storage id separately from the URL scope predicate (LWS id
and root may differ). Do not fetch JSON-LD contexts. Scope-filter objects before dedupe and
scope-filter optional target/origin URLs. Never log raw frames or untrusted URL credentials.
Dedupe is per normalizer, by accepted id, expiring at exactly five seconds.

`./testing` provides fake timers, sockets and event sources without network or Node-only
imports. Advance fake timers asynchronously to await complete polling cycles. Keep transport
factories and clocks injectable; later push tasks consume the socket/event-source/random hooks.

Before implementation, read SDK core ADR-001 D4 and `ADR-005-live-updates.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and
adversarial tests with every behavior change. Keep development tool versions aligned with
the root manifest. The pinned pnpm 10.4.1 with `ignore-scripts` requires local tool declarations
for filtered scripts. Validate with this package's lint, dependency-first build, typecheck and
test scripts, and the repository gate.
