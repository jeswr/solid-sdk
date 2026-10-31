<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/storage-conformance

> **Experimental — AI-agent-generated.** Private conformance tool, Node.js >=24.

ADR-009 / T-080: shared SC-LIST, SC-RW, SC-RDF, SC-DEL and SC-ERR scenarios run unchanged
against reference memory storage (Solid and LWS) and the published sparq Solid WASM pod.
The package's Vitest suite runs all three targets by default, including in `gate:full`.

From the workspace root:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm run conformance -- --target memory,sparq-solid
# memory expands to memory-solid and memory-lws; each can also run individually.
pnpm run conformance -- --target memory --output /tmp/storage-conformance
TARGET=memory pnpm --filter @jeswr/storage-conformance test
```

The root command builds dependencies first. `TARGET` is the fallback selection; `--target`
takes precedence. Unknown names/flags fail. The default output is this tool's directory.
Every run writes `reports/<target>.json` (an array of `{ test, status, feature, reason }`) and
regenerates `MATRIX.md` from exactly the selected targets. Any failed assertion, target startup,
discovery, capability claim or cleanup makes the command exit 1. Reports omit exception text,
credentials and resource URLs. JSON reports and the full-target matrix are committed evidence;
rerun all targets before committing the matrix to avoid overwriting it with a partial run.

`storageCases`, `runTarget`, `evaluateCase`, `compareClaims`, `selectTargets`, the built-in target
factories, and report generators are exported from the root. `./testing` exports structured
StorageError assertions and small-fixture RDF graph isomorphism (including blank-node bijections).
Each scenario uses a fresh container; targets start once, are isolated between runs, and stop
in `finally`. The sparq fetch adapter calls `createSolidPod().dispatch()` in process and opens no
ports. It preserves response URLs, repeated headers and binary bytes and refuses foreign origins.
The fixed-owner targets explicitly refuse requests for a different identity; they cannot test 403
with a second principal. HTTP-only errors such as LWS raw unconditional PUT's 428 need a future
LWS HTTP target. Memory exposes its direct public StorageClient and has no HTTP transport.

Every scenario declares `requires`. For an unavailable/unknown feature, a companion probe must
prove absence before the scenario can skip with `target-lacks:<feature>`. A working operation
fails with `advertisement-missing:<feature>`; a missing or throwing probe fails closed. LWS
network move probes PATCH the real linkset, bypassing the SDK's advertisement guard so an
unadvertised server implementation cannot hide behind `unsupported`. Available features must run
and pass; returning or throwing a skip is a failure. Independent target claims compare protocol,
feature state and detail against discovery/derivation; evidence strings are explanatory only.
Memory derives from its synthetic description because it has no discovery HTTP endpoint.

Baseline read/write/RDF/delete tests have no optional prerequisite. Local RDF parsing of an
opaque LWS body does not require server content negotiation, and recursive client traversal does
not require the separate recursive-delete service. The RDF cases cover Turtle and inline-context
JSON-LD input, Turtle `writeRdf`, and semantic prefix/blank-node preservation. The stacked SDK
explicitly refuses JSON-LD serialization; the suite asserts its structured `unsupported` error.

Current integration limitations:

- Pinned `@sparq-org/solid-server@0.1.6` starts with no root. The target provisions it with a real
  conditional PUT. Its subsequent HEAD has LDP/ACL links but no storage-description, LWS storage
  or Updates-Via discovery link. The public `createPodClient` fails with `no-storage-link`.
  Supplying a storage-description Link on root PUT is ignored by this server. No discovery
  headers, advertisements or backend selection are fabricated to make the target pass.
- T-080's requested sparq-solid `requires:['move']` skip conflicts with the stacked SDK and
  ADR-009 D3: Solid move is always available as copy/delete emulation. The harness preserves
  that contract. The real `target-lacks:move` skip is exercised on memory-lws and on synthetic
  unknown/unavailable targets in the gating regression tests.

The move operation in SC-ERR is a capability-gating witness. The full move group and the other
ADR-009 groups and targets belong to later tasks.
