---
name: pod-access
description: Use when maintaining @jeswr/pod-access offline WAC/ACP translation, policy reports, bounded access proofs or notification delivery, or assessing its unimplemented sharing and grant APIs.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pod-access

This package owns the offline WAC/ACP translation core extracted from `apps/pod-migrator`:
readers/writers, neutral policy/report types, conservative translation, inheritance composition,
and bounded access proofs. `./notify` implements SDK-APP-07 over `solid-agent-notify/client`.
See `README.md` for exports. The broader sharing client from SDK core ADR-003 §9 is still
unimplemented; the `./testing` entry point remains reserved.

## Quick reference

There is no `share()`, grant CRUD, permission query or usable test fake yet; do not invent
examples, import planned exports or implement a replacement inside an app.

Use [storage-capabilities](../storage-capabilities/SKILL.md) to inspect
`features.accessControl` (`wac`, `acp`, `odrl-grants`, `none`), `accessRequests` and
`accessGrants`. An available service describes server support; it does not provide a
pod-access sharing client or prove the caller has permission. Keep sharing controls
unavailable until the required integration exists. `ReadResult.allow === null` means the
server supplied no usable hint; it does not establish denial or access.

Read [LWS app differences](../../skills/lws-vs-solid/SKILL.md) for grant versus token
semantics. Do not assume WAC ACL documents work against an LWS grant service.

## Notification delivery

`createNotify({ fetch, clock?, recipientProtocol?, pinningFetch? })` returns a callable
`notify(agentWebId, activity)`. Supply the pod-auth fetch and an explicit actor WebID.
Builders return templates without actor: `shareNotification`, `assignmentAnnounce`,
`mentionNotification`, `roomInvitation`. Preserve Tasks §5.7's assignment summary exactly.
Delivery failures return structured values and never throw. Do not change permissions here.

Discovery caches exact recipient WebIDs for ten minutes within a notifier instance; recreate
the notifier on account/session changes. Known LWS recipients use `recipientProtocol(webId)`;
never infer the recipient's protocol from the sender's storage. LWS media types also short-circuit.
Only one unambiguous NamedNode inbox on the exact WebID subject is accepted. Profiles and
inboxes use public HTTPS and refuse redirects. Node hostname targets require an authenticated
`pinningFetch`; never silently label an ordinary auth fetch as DNS-pinned. Browsers retain the
guard's documented DNS limitation. All parsing goes through fetch-rdf, with remote contexts refused.

Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial
tests with the implementation. Retain the migrator's conservative source readings, widest target
readings, target ACP allowlist, bounded complexity, report IDs/options, and dialect behavior.
Server implementation is a trusted caller assertion, never derived from editable access RDF.

The migrator owns HTTP, public group snapshots, review decisions, effective target phase proofs,
scope checks, conditional persistence, and execution. Run its tests when changing this core;
serializing a translated policy alone does not establish safe migration.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, dependency-first `build`, `typecheck`, and `test` scripts,
plus the migrator's regression suite and the repository gate.
