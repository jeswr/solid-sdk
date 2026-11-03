---
name: solid-notifications
description: Use when routing existing Solid notification integrations to @jeswr/pod-notifications for storage-scoped changes, push/polling lifecycle and missed-event reconciliation.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Quick reference

Use the colocated [pod-notifications skill](../../packages/pod-notifications/SKILL.md)
for `createNotifications`, subscription cleanup, supported channels, polling and resync.
It owns the current API and its Solid, LWS and legacy NSS behavior.

Pass bounded `auth.fetch` from [pod-auth](../../packages/pod-auth/SKILL.md) and the public
`storage` client from [storage-client](../../packages/storage-client/SKILL.md).
Read [LWS app differences](../lws-vs-solid/SKILL.md) when migrating container subscriptions;
recursive depth and fallback polling provide different coverage.

For protocol-level discovery and specification sources, use [solid-lws](../solid-lws/SKILL.md).
