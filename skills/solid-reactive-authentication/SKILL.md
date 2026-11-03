---
name: solid-reactive-authentication
description: Use when migrating legacy @solid/reactive-authentication integrations to @jeswr/pod-auth or locating historical direct-provider maintenance references.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Quick reference

Use the colocated [pod-auth skill](../../packages/pod-auth/SKILL.md) for current suite
applications: `createPodAuth`, bounded `auth.fetch`, restore, React integration and Node agents.
It also owns migration guidance for the four deprecated client auth packages.

The imported [reactive-authentication engine skill](../../packages/reactive-authentication/SKILL.md)
describes protocol internals. The external published `@solid/reactive-authentication` 0.1.x
API and its global-fetch setup differ from that engine and current pod-auth policy.
Read [LWS app differences](../lws-vs-solid/SKILL.md) for storage and grant semantics.

Only when maintaining an existing direct-provider integration, consult these historical
references; they are not templates for a new app:

- [Session restore](references/session-restore.md).
- [Client authentication and autologin](references/client-auth-and-autologin.md).
- [Login lifecycle and races](references/login-lifecycle.md).
- [Proactive authentication and pristine fetch](references/proactive-auth.md).

For Auth.js rather than suite client sessions, use [auth-solid](../../packages/auth-solid/SKILL.md).
