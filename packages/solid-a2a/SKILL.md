---
name: solid-a2a
description: Use when maintaining @jeswr/solid-a2a intent translation, SHACL validation, protocol documents or upgrade handshakes, including validation resource limits and worker packaging.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# solid-a2a

This package is security-critical. Read [README.md](README.md) for the public contracts.

- Preserve `validateIntent`'s async, never-throw report contract. Refused inputs, exhausted
  budgets, invalid timeout options, timeouts and worker failures return `conforms: false`
  with a diagnostic in `results`; there is no validation exception type or error code.
- `src/validationCore.ts` owns the step-model pre-check and shared 20,000-operation
  budget across validator datasets; `validationLimits.ts` owns quad-count and term caps.
  Keep these protections in the worker and in the browser fallback.
- Node validation uses a lazy bounded pool, defaulting to min(2, availableParallelism())
  workers and 64 queued calls. Preserve configurable `ValidationWorkerPool` size/queue
  bounds, per-worker resource limits, ready-before-dispatch warming and idle `unref()`.
  Count queue wait, input preparation and startup against each call's deadline (2000 ms
  by default, integer 1–2147483647). Refuse a full queue and late reports. Await termination
  after a timeout/crash/messageerror before settling the affected call; never reuse that
  worker. Replacement on pending work must include terminating workers in the pool cap.
  `closeValidationPool()` closes the shared pool, and `pool.close()` refuses pending calls
  and awaits termination. Successful workers are reused; closed instances stay closed.
- Shared quad-count and term caps in `validationLimits.ts` run before copying/converting or
  serializing on the caller as well as in the worker. Bound dataset iteration and
  structured intent lowering too. Raw duplicate quads count toward the input cap.
  Keep input adapters in `validationInputs.ts`; workers receive quads and must not import
  intent translation, RDF parsers or serialization dependencies during startup.
- The build ships Node ESM, with `dist/validationWorker.js` beside `dist/index.js`.
  Bundlers must separately copy/emit the worker asset and configure a pool's `workerUrl`
  or trusted `workerFactory`. Factories receive the URL and resource limits and return
  fresh Node-compatible Workers speaking the shipped ready/request/report protocol.
  Missing worker_threads or worker assets must give actionable configuration diagnostics,
  fail closed and never silently fall back to in-process work. Keep Node builtins lazy.
- `execution: "in-process"` explicitly opts into weaker synchronous metering with no
  wall-clock guarantee; browser environments use it by default. Preserve all three
  existing protections there. There is no shipped browser Web Worker entry.
- `validationTransfer.ts` explicitly carries literal language AND RDF 1.2 direction;
  N3 `fromTerm`/`fromQuad` drop direction and must not be used on the transfer path.
  Preserve blank node identifiers, named graphs, datatype IRIs and literal values.
  Namespace normalization must preserve direction too and remain confined to disposable
  validation views; hashing and serialization retain the original graph.
- `scripts/build-dist.mjs` bundles and sanitizes both entrypoints. Both package test scripts
  build first: native workers cannot execute Vitest transforms, so worker tests use fresh
  built output. `test/validationPaths.ts` also runs the entire conformance, alias,
  namespace and hardening matrix directly against the source `validateGraphs` function.
  Do not replace these source core tests with dist imports. The slow-validator hook
  exists only in test fixtures; keep it out of the public API and production worker.

Validate changes with the existing conformance, alias and hardening tests plus
`test/validation-timeout.test.ts` and `test/validation-pool.test.ts`. These suites simulate
an infinitely busy synchronous validator, check actual termination and parent responsiveness, and cover timeout options,
concurrency, queue admission/expiry, shutdown, resource limits, worker configuration,
direction preservation, messageerror and crash replacement. Follow the root gate requirements
and keep changes inside the authorized package scope.
