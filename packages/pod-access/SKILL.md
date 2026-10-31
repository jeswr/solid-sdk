---
name: pod-access
description: Work on @jeswr/pod-access, the pod sharing and permissions across access-control models package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-access

`./notify` implements SDK-APP-07 over `solid-agent-notify/client`. The root and testing
entry points remain reserved; sharing/grant APIs are not implemented in this checkout.

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

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial tests with the implementation.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.
