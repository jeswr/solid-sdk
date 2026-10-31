---
name: storage-conformance
description: Work on @jeswr/storage-conformance, the shared storage conformance suite package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/storage-conformance

T-080 implements the shared conformance runner, report generators, and SC-LIST/RW/RDF/DEL/ERR.
The root entry exports scenarios, targets, `runTarget`, `evaluateCase`, `compareClaims`,
`generateMatrix`, and `writeReports`; `./testing` exports structured error and RDF isomorphism assertions.

Run `pnpm run conformance -- --target memory,sparq-solid` from the workspace root. It builds
dependencies, writes per-target JSON, regenerates this tool's MATRIX.md, and exits 1 on any
failure. The package Vitest suite runs the same scenarios on all targets by default; `TARGET`
can narrow a local run. Keep the default full-target tests and the 90% coverage thresholds.

Every scenario declares `requires`; absent/unknown features need a companion absence check.
Do not interpret arbitrary network/server errors as evidence of absence. An unadvertised
working operation fails with `advertisement-missing:<feature>`. Available features cannot skip.
Compare target claims independently of the derive function; ignore evidence strings only.
Network absence probes must try the real protocol operation, not the SDK's capability guard.

Use only public storage-client APIs. Memory uses `createMemoryStorage`; sparq uses
`createSolidPod` with fixed-owner auth, then public `createPodClient` over a dispatcher fetch
adapter. Never supply a fake second identity to the fixed-owner server. Always free WASM after
failed setup. Keep reports free of exception text, credentials and URLs.

Read README.md's current integration limitations before interpreting report failures:
the pinned sparq 0.1.6 server has no discovery link, and Solid move is advertised as emulated
by the stacked SDK (so T-080's requested Solid move skip conflicts with ADR-009 D3).
Do not bypass discovery, synthesize server advertisements or alter SDK security to hide these.
JSON-LD serialization is unsupported upstream; JSON-LD input and Turtle writes are covered.

Before implementation, read SDK core ADR-001 D4 and `ADR-009-test-strategy.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.
