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
  budget across validator datasets; `validationLimits.ts` owns quad-count, term and
  aggregate character caps (1 Mi data / 4 Mi shapes, UTF-16 code units).
  Keep these protections in the worker and in the browser fallback.
- Node validation uses a lazy bounded pool, defaulting to min(2, availableParallelism())
  workers and 64 queued calls. Preserve configurable `ValidationWorkerPool` size/queue
  bounds, per-worker resource limits (512 MiB old / 16 MiB young / 4 MiB stack),
  ready-before-dispatch warming and idle `unref()`. Worker warm-up has an independent
  configurable `startupTimeoutMs` (default 10000), surviving short caller deadlines.
  Count queue wait, input preparation and startup against each call's deadline (2000 ms
  by default, integer 1–2147483647). Refuse a full queue and late reports. Retire workers
  after a posted job times out or a worker crashes/fails; await termination with at most
  100 ms grace before settling the call. Queued expiry or expiry during encoding must
  leave unused workers alive. Keep retiring workers against the pool cap until termination
  succeeds or exit is observed, even when terminate rejects or hangs.
  `closeValidationPool()` closes the shared pool, and `pool.close()` refuses pending calls
  and awaits termination with bounded grace. Successful workers are reused; closed
  instances stay closed. Submission is module-internal, never a public uncapped `run()`.
- Shared quad-count, aggregate character and term caps in `validationLimits.ts` run
  before copying/converting or serializing on the caller as well as in the worker.
  Bound dataset iteration and structured intent lowering too. Raw duplicate quads count toward the input cap.
  Keep input adapters in `validationInputs.ts`; workers receive N-Quads and must not
  import intent translation or the general fetch/serialization dependency graph during
  startup. N3 Parser/Writer handle the bounded validation transfer.
- The build ships Node ESM, with `dist/validationWorker.js` beside `dist/index.js`.
  Bundlers must separately copy/emit the worker asset and configure a pool's `workerUrl`
  or trusted `workerFactory`. Factories receive the URL and resource limits and return
  fresh Node-compatible Workers speaking the shipped ready/request/report protocol.
  Missing worker_threads or worker assets must give actionable configuration diagnostics,
  fail closed and never silently fall back to in-process work. Keep Node builtins lazy.
- `execution: "in-process"` explicitly opts into weaker synchronous metering with no
  wall-clock guarantee; browser pages use it by default. Other non-Node runtimes require
  an explicit execution choice and otherwise fail closed. Preserve all input/operation
  protections there. There is no shipped browser Web Worker entry.
- `validationTransfer.ts` uses N3 Writer/Parser N-Quads, including literal language AND
  RDF 1.2 direction. Parse with `blankNodePrefix: ""` to preserve identifiers across
  data and shapes. N3 `fromTerm`/`fromQuad` drop direction and must not be used on the
  transfer path. Preserve named graphs, datatype IRIs and literal values.
  Namespace normalization must preserve direction too and remain confined to disposable
  validation views; hashing and serialization retain the original graph.
- `scripts/build-dist.mjs` bundles and sanitizes both entrypoints. Both package test scripts
  build first: native workers cannot execute Vitest transforms, so worker tests use fresh
  built output. `test/validationPaths.ts` also runs the entire conformance, alias,
  namespace and hardening matrix directly against the source `validateGraphs` function.
  Do not replace these source core tests with dist imports. The slow-validator hook
  exists only in test fixtures; keep it out of the public API and production worker.

Validate changes with the existing conformance, alias and hardening tests plus
`test/validation-timeout.test.ts`, `test/validation-pool.test.ts` and
`test/validation-round2.test.ts`. These suites simulate
an infinitely busy synchronous validator, check actual termination and parent responsiveness, and cover timeout options,
concurrency, queue admission/expiry, shutdown, resource limits, worker configuration,
direction preservation, messageerror and crash replacement. Follow the root gate requirements
and keep changes inside the authorized package scope.
