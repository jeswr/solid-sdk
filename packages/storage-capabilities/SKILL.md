---
name: storage-capabilities
description: Use when working on @jeswr/storage-capabilities, the storage description discovery and feature flags package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/storage-capabilities

T-010 implements the ADR-002 vocabulary and type contracts, plus internal Link/probe-header parsers.
The root entry point exports types; `./vocab` exports vocabulary objects (`LWS.Storage`,
`SOLID.storageDescription`, and the other ADR-002 IRIs). `./cache` and `./testing` remain reserved.

Before implementation, read SDK core ADR-001 D4 and `ADR-002-capabilities.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

Reuse `src/link.ts` for Link parsing. Its output retains the resolved `context` from `anchor`;
callers must check that context before treating a link as metadata about the response resource.
`src/probe-headers.ts` converts supplied response headers into `ProbeResult` without fetching.
Pass ordered raw header pairs when response evidence order matters; a `Headers` instance may
already have sorted/combined the fields. Network probing belongs to the resolver task.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.
