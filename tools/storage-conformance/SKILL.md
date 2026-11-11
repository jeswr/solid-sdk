---
name: storage-conformance
description: Work on @jeswr/storage-conformance, the shared storage conformance suite package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-conformance

T-080 implements the shared conformance runner, report generators, and SC-LIST/RW/RDF/DEL/ERR.
T-081 adds CSS, SC-PATCH/MOVE/META/CAP and opt-in storage fixture recording/replay.
The root entry exports scenarios, targets, `runTarget`, `evaluateCase`, `compareClaims`,
`generateMatrix`, and `writeReports`; `./testing` exports structured error and RDF isomorphism assertions.

Run `pnpm run conformance -- --target memory,sparq-solid` from the workspace root. It builds
dependencies, writes per-target JSON, regenerates this tool's MATRIX.md, and exits 1 on any
failure. The package Vitest suite defaults to both memory protocols while pinned sparq 0.1.6
cannot complete discovery. `TARGET` explicitly selects targets and requires them to pass;
the CLI still defaults to all targets and reports failures. Keep the 90% coverage thresholds.

Shared listing assertions must follow opaque `list()` cursors and validate complete membership
independently of `listAll()`, without assuming a page size. Configure `paginationWitnessSize`
in target setup when its page size is known, so configured pagination must actually occur.

Every scenario declares `requires`; absent/unknown features need a companion absence check.
Do not interpret arbitrary network/server errors as evidence of absence. An unadvertised
working operation fails with `advertisement-missing:<feature>`. Available features cannot skip.
Compare target claims independently of the derive function; ignore evidence strings only.
Network absence probes must try the real protocol operation, not the SDK's capability guard.

`--target css` starts pinned CSS 7.2.0 in process with disposable file storage and one account
per test file, authenticated through pod-auth client credentials. Its root is seeded private;
anonymous reads must fail. Never record account/token exchanges. `RECORD=1` captures storage
traffic per run and scenario under `packages/storage-client/testing/fixtures/<target>/`.
Use the existing recorder's redaction, inspect decoded bodies, and refresh curated baseline
captures with both packages' offline tests. Preserve setup/runner-discovery separation.

SC-CAP must count OPTIONS with a fresh cache when declarations are incomplete, and zero
probes for complete advertisements. Do not claim CSS's OPTIONS reveals WAC: it omits those
headers. CSS metadata lacks ETags; assert conditional edit refusal and keep memory add/remove
coverage. Local SDK refusals have null HTTP status. Do not accept CSS's RDF negotiation 500
as `not-rdf` or skip the existing baseline case to obtain a green report.

Use only public storage-client APIs. Memory uses `createMemoryStorage`; sparq uses
`createSolidPod` with fixed-owner auth, then public `createPodClient` over a dispatcher fetch
adapter. Never supply a fake second identity to the fixed-owner server. Always free WASM after
failed setup. Keep reports free of exception text, credentials and URLs.

Read README.md's current integration limitations before interpreting report failures:
the pinned sparq 0.1.6 server has no discovery link, and Solid move is advertised as emulated
by the stacked SDK (so T-080's requested Solid move skip conflicts with ADR-009 D3).
Do not bypass discovery, synthesize server advertisements or alter SDK security to hide these.
Memory targets set `jsonLdWrites: true`: require semantic JSON-LD write round-trips, accurate
media types and stale-validator rejection. This describes SDK serialization, not the server's
`rdfConneg` feature. HTTP backends still refuse JSON-LD serialization; require `unsupported`
and unchanged validators/data. JSON-LD input and Turtle writes remain covered on every target.

Before implementation, read SDK core ADR-001 D4 and `ADR-009-test-strategy.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.


SDK-APP-05 registration integration lives in `integration/registration.test.ts` and runs with
`pnpm run test:registration` after dependency-first builds. It reuses cssTarget.start(), drives
real CSS password/OIDC UI controls without mocking the protocol engine, and checks RDF names
plus authenticated private-pod access. Preserve its anonymous 401/403 witness and finally cleanup.
It is a separate socket-based lane per ADR-009, with no skips or environment opt-in flag.
