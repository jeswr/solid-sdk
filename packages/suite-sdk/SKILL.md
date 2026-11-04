---
name: suite-sdk
description: Use when working on the @jeswr/suite-sdk React notification facade and useNotify integration with PodAuthProvider.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/suite-sdk

This package currently exposes only SDK-APP-07's `useNotify()` and notification builders.
Do not infer that the other planned SDK facade APIs are implemented.

Read `packages/pod-access/SKILL.md` for notification API details. Use `PodAuthProvider` from
`@jeswr/pod-auth/react`; never create another auth session or modify credentials in this facade.
The notifier cache belongs to the current identity and must reset on lifecycle/account changes.
Recipient protocol hints describe the recipient, independently of the current identity's protocol.
Preserve the explicit DNS-pinning requirement for Node transports and all redirect refusals.

Run `lint`, dependency-first `build`, `typecheck` and `test`; coverage thresholds are 100%.
