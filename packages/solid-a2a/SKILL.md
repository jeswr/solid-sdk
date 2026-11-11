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
- `src/validationCore.ts` owns the existing three protections: the step-model pre-check,
  term-length caps and the shared 20,000-operation budget across validator datasets.
  Keep these protections in the worker and in the browser fallback.
- Node validation uses a new worker for each call. `ValidationOptions.timeoutMs` defaults
  to 2000 ms and accepts integers from 1 to 2147483647. Include startup and all core checks
  in the deadline, reject late success reports, and finish terminating the worker before
  settling the call. Fail closed on worker errors or exits without a report; do not fall
  back to synchronous execution in Node. Input lowering and transfer remain on the caller.
- The current build ships Node ESM, with `dist/validationWorker.js` beside `dist/index.js`.
  Browser bundles use synchronous metering; they have no wall-clock guarantee and do not
  have a shipped Web Worker entry. Keep Node builtins lazy in the main entry.
- Graph transfer uses N3's JSON term representation and `DataFactory.fromQuad` to restore
  RDF/JS prototypes. Preserve blank node identifiers, named graphs, datatype IRIs, literal
  values and language tags. Namespace normalization stays in disposable validation views;
  hashing and serialization retain the original graph.
- `scripts/build-dist.mjs` must bundle and sanitize both entrypoints. Build before testing:
  native workers cannot execute Vitest's TypeScript transforms, so the test setup routes
  source worker URLs to the built artifact. The slow-validator hook exists only in test
  fixtures; keep it out of the public API and production worker.

Validate changes with the existing conformance, alias and hardening tests plus
`test/validation-timeout.test.ts`. That suite simulates an infinitely busy synchronous
validator, checks actual termination and parent responsiveness, and covers timeout options
and worker failures. Follow the root gate requirements and keep changes inside the
authorized package scope.
