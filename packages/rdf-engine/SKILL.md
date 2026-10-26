---
name: rdf-engine
description: Work on @jeswr/rdf-engine, the lazy rdf engine facade for local query and validation package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/rdf-engine

T-070 implements lazy single-document parse/serialize, SHACL validation and RDFC-1.0
canonicalization. The Node entry uses the prebuilt wasm-node module; the browser entry accepts
a configured wasmUrl and ships a content-hashed static-asset copy script. Keep Sparq pinned
to 0.1.5 and feature-detect optional serialize/parseShaclCompact bindings.

The testing entry is n3-backed and must never import Sparq at runtime. Its JSON-LD operations
and blank-node canonicalization throw FakeEngineUnsupportedError. Its validator is injectable,
defaulting to a conforming empty report; tests of SHACL semantics must use the real engine.

Always release temporary WASM stores in finally. Returned datasets are materialized into
JavaScript memory. The shared contract runs on both engines; JSON-LD, SHACL and blank-node
canonicalization have a separate real-engine contract. Preserve the 90% coverage gate, the
installed-WASM size test and bench/bundle.json measurement (gzip level 9).

The shared contract also covers LocalIndex graph lifecycle (put/remove/has/size/dispose).
Real indexes own one WASM store; engine disposal releases every owned index. T-071 owns
the later query/stream, snapshot/restore, persistence and LRU surfaces.

Before implementation, read SDK core ADR-001 D4 and `ADR-007-sparq-wasm.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.

<!-- AUTHORED-BY Codex GPT-6 -->
T-072 adds evaluatePolicy and deriveForm. Keep solid-odrl authoritative: the
experimental Sparq policy probe is not a compatible adapter. Detect a callable
policyEvaluate only with a finite numeric policyContractVersion >= 1; even then
retain solid-odrl until an adapter contract is approved. Project matched rule IDs
and active unfulfilled duty IDs; duties remain advisory. Anonymous IDs use
one-based dataset document order; naming must never change evaluation inputs.
The fake uses the same delegate and throws FakeEngineUnsupportedError for forms.
FormDescription JSON is passed through unchanged and temporary stores are freed
on every path. bench/parse.bench.ts records materialized-dataset parse timings;
commit bench/parse.json and document the crossover without changing fetch-rdf's
default in this package lane.
