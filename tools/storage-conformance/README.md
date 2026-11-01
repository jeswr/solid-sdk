<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/storage-conformance

> **Experimental — AI-agent-generated.** Private conformance tool, Node.js >=24.

ADR-009 / T-080–081: shared SC-LIST, SC-RW, SC-RDF, SC-DEL, SC-ERR, SC-PATCH, SC-MOVE,
SC-META and SC-CAP scenarios run against memory (Solid and LWS), CSS and the sparq Solid WASM pod.
The package's Vitest suite runs both memory protocols by default, including in `gate:full`.
Set `TARGET=sparq-solid` to require the sparq target to pass once its discovery is compatible.
The CLI still selects all three targets by default and reports sparq's startup failure.

From the workspace root:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm run conformance -- --target memory,sparq-solid
# memory expands to memory-solid and memory-lws; each can also run individually.
pnpm run conformance -- --target memory --output /tmp/storage-conformance
TARGET=memory pnpm --filter @jeswr/storage-conformance test
pnpm run conformance -- --target css
RECORD=1 pnpm run conformance -- --target css,sparq-solid
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

CSS is pinned to `@solid/community-server@7.2.0`. It runs in this process, on a free loopback
port, with `config/file.json` and a temporary directory. Components.js loads only the pinned
server's dependency graph, avoiding other CSS versions installed in this pnpm workspace.
Each `start()` seeds one account through the account API, obtains a session through
`pod-auth/node`'s `forClientCredentials`, and makes the root owner-only using a conditional
SDK ACL write. An anonymous request must then get 401/403. Credentials stay in memory.
The single `conformance.test.ts` starts one account per file; scenarios use separate containers.
CSS remains an explicit manual target. Its full 1,500-member suite takes about three minutes
here on Node 24; Vitest allows ten minutes. Independent fixture creates overlap in batches of 16.

`RECORD=1` writes storage exchanges under
`packages/storage-client/testing/fixtures/{css,sparq-solid}/<run-uuid>/<scenario>/`.
`setup` contains client creation, `discovery` contains the runner's independent resolution,
and every SC scenario gets its own sequence. Account creation, token exchange, and ACL seeding
are outside the recorder. Captures use storage-client's header redaction and exclusive files;
normal runs write no fixtures. Inspect public URLs and decoded bodies before committing.
Curated `baseline/` captures exercise six CSS scenarios offline in this tool, and CSS
discovery/patch/metadata plus sparq's discovery failure in storage-client unit tests.
To refresh them, copy a fresh run's `setup` and the existing baseline scenario directories
into `baseline/`, then run both packages' tests. Failed sparq startup still records its real
root provisioning and HEAD; discovery is never fabricated to obtain a larger capture.

PATCH tests compare RDF results isomorphically, check stale validators, JSON Patch and
conditional `where`. Unsupported combinations must fail before HTTP; the JSON absence check
also PATCHes the server directly. MOVE checks content, containment, native/emulated behavior,
the identifier-preservation claim and container cycles. META checks `up` on LWS, custom
relation add/remove and reserved LWS relations; absent documents or validators exercise the
SDK's structured refusal. CAP resolves with a fresh cache, checks OPTIONS only when a Solid
description omits patch/access-control declarations, and requires subsequent cached calls
to make no requests. Complete advertisements have a regression test requiring zero probes.

Every scenario declares `requires`. For an unavailable/unknown feature, a companion probe must
prove absence before the scenario can skip with `target-lacks:<feature>`. A working operation
fails with `advertisement-missing:<feature>`; a missing or throwing probe fails closed. LWS
network move probes PATCH the real linkset, bypassing the SDK's advertisement guard so an
unadvertised server implementation cannot hide behind `unsupported`. Available features must run
and pass; returning or throwing a skip is a failure. Independent target claims compare protocol,
feature state and detail against discovery/derivation; evidence strings are explanatory only.
Memory derives from its synthetic description because it has no discovery HTTP endpoint.

Listing scenarios traverse opaque `list()` cursors and check complete, duplicate-free membership
independently of `listAll()`. They impose no fixed page size. Targets can set
`paginationWitnessSize` to require a page break for fixtures at least that large; memory LWS
sets it from its configured `pageSize` (100 by default).

Baseline read/write/RDF/delete tests have no optional prerequisite. Local RDF parsing of an
opaque LWS body does not require server content negotiation, and recursive client traversal does
not require the separate recursive-delete service. The RDF cases cover Turtle and inline-context
JSON-LD input, Turtle `writeRdf`, and semantic prefix/blank-node preservation. The stacked SDK
explicitly refuses JSON-LD serialization; the suite asserts its structured `unsupported` error.
Non-RDF reads must return `not-rdf`. Malformed Turtle may instead be rejected during creation
with HTTP 400 or 422 (`bad-request`); if stored, reading it as RDF must return `not-rdf`.

Current integration limitations:

- CSS's root description advertises notification services but no patch/access-control entries.
  OPTIONS supplies neither ACL nor WAC-Allow, so discovery reports accessControl unknown and
  uses the SDK's default N3 patch probe result. SC-CAP witnesses the real OPTIONS request.
  Generated `.meta` documents have no ETag: reads work, and conditional metadata edits must
  fail with `precondition-failed` rather than inventing a validator. Memory covers add/remove.
- CSS returns HTTP 500 when `readRdf` negotiates RDF from the plain-text fixture. The existing
  SC-RDF-not-rdf assertion remains a failure; server errors are not accepted as `not-rdf`.
  Thus the full CSS target is not yet green, although the T-081 scenarios pass. SDK/server
  negotiation policy needs a separate decision; this lane does not change production behavior.
- Pinned `@sparq-org/solid-server@0.1.6` starts with no root. The target provisions it with a real
  conditional PUT. Its subsequent HEAD has LDP/ACL links but no storage-description, LWS storage
  or Updates-Via discovery link. The public `createPodClient` fails with `no-storage-link`.
  Supplying a storage-description Link on root PUT is ignored by this server. No discovery
  headers, advertisements or backend selection are fabricated to make the target pass.
- T-080's requested sparq-solid `requires:['move']` skip conflicts with the stacked SDK and
  ADR-009 D3: Solid move is always available as copy/delete emulation. The harness preserves
  that contract. The real `target-lacks:move` skip is exercised on memory-lws and on synthetic
  unknown/unavailable targets in the gating regression tests.

The move operation in SC-ERR remains a capability-gating witness. NOTIFY/AUTH/ACCESS/SYNC and
the LWS HTTP target belong to later tasks.
