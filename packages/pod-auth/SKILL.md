---
name: pod-auth
description: Use when working on @jeswr/pod-auth, the suite client authentication and session lifecycle package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-auth

This is the T-001 scaffold. All entry points are empty modules; no runtime API is implemented.

Before implementation, read SDK core ADR-001 D4 and `ADR-004-auth.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial tests with the implementation.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.
