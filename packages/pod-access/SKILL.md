---
name: pod-access
description: Use when assessing @jeswr/pod-access sharing support or maintaining its reserved entry points; this checkout has an empty scaffold and no runtime permissions API.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-access

## Quick reference

Both `@jeswr/pod-access` and `@jeswr/pod-access/testing` export empty modules in this
checkout. There is no `share()`, grant CRUD, permission query or usable test fake yet; do not
invent examples, import planned exports or implement a replacement inside an app.

Use [storage-capabilities](../storage-capabilities/SKILL.md) to inspect
`features.accessControl` (`wac`, `acp`, `odrl-grants`, `none`), `accessRequests` and
`accessGrants`. An available service describes server support; it does not provide a
pod-access client implementation or prove the caller has permission. Keep sharing controls
unavailable until the required integration exists. `ReadResult.allow === null` means the
server supplied no usable hint; it does not establish denial or access.

Read [LWS app differences](../../skills/lws-vs-solid/SKILL.md) for grant versus token
semantics. Do not assume WAC ACL documents work against an LWS grant service.

Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial tests with the implementation.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.
