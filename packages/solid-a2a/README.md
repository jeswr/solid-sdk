<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-a2a

Translate natural-language agent requests into RDF intents and validate them against hash-pinned
SHACL protocol documents.

The library is transport- and model-independent: common intents use deterministic parsing, while
unmatched text can be passed to an injected translator.

> Experimental. Security-bearing exchanges must not silently downgrade from validated RDF back to
> natural language.

## Install

```sh
npm install github:jeswr/solid-a2a#main
```

Requires Node.js 24 or newer.

## Minimal usage

```ts
import {
  buildProtocolDocument,
  buildResponseShape,
  buildShapeForIntent,
  parseIntent,
  validateIntent,
} from "@jeswr/solid-a2a";

const parsed = await parseIntent(
  "share read access to https://alice.example/notes.ttl with https://bob.example/profile#me",
);
if (!parsed.resolved || !parsed.intent) throw new Error(parsed.reason);

const requestShape = buildShapeForIntent("grant");
const report = await validateIntent(parsed.intent, requestShape);
if (!report.conforms) throw new Error("Intent does not conform to the protocol shape");

const protocol = await buildProtocolDocument({
  requestShape,
  responseShape: buildResponseShape("https://schema.org/AuthorizeAction"),
  meta: { id: "https://alice.example/protocols/grant#v1", name: "Grant access", version: "1" },
});
```

## Key API

- Intent translation: `parseIntent` and the optional `TranslateFn` seam.
- RDF: `intentToTurtle`, `intentToJsonLd`, `parseIntentGraph`, `intentFromRdf`.
- SHACL: `buildShapeForIntent`, `buildResponseShape`, `validateIntent`.
- Protocol documents: `buildProtocolDocument`, `verifyProtocolDocument`, `hashQuads`.
- Handshake: `encodeUpgradeOffer`, `decodeUpgradeOffer`, `encodeUpgradeResponse`,
  `decodeUpgradeResponse`, `mayDowngradeToNl`, and RDF codecs.

## Reading untrusted intents

- `intentFromRdf` / `parseIntentGraph` return `undefined` for anything ambiguous: a
  graph with more than one `a2a:Intent`, an action typed with more than one kind, more than one target, recipient or agent, an
  action agent that differs from the intent agent, an unknown `a2a:mode`, or an IRI that
  is not absolute. The request shapes do not bound these, so act on the projection, not
  on `validateIntent` alone.
- `validateIntent` never throws: an Intent the writers refuse, or a shape the validator
  cannot compile, is `conforms: false`. Timeouts and worker startup/runtime failures use
  that same report, with a diagnostic in `results[0].message`. Shapes using `sh:pattern`
  remain refused: a peer's pinned Protocol Document is not vetted.
  For the same reason a validation is refused before it starts when its cost is not bounded:
  SHACL outside the Core subset (no `sh:pattern`, `sh:qualifiedValueShapesDisjoint` or SPARQL),
  `rdfs:subClassOf` in the shapes or the intent graph, a looping, branching or long RDF list, a
  property path that unfolds past 64 nodes, inverts anything but a predicate, nests a `*`/`+`
  path inside another, or gives one path node two forms, a repeated constraint parameter (other
  than shape references, `sh:class`, targets and labels), a shape reference cycle, an oversized
  graph, or more than 5000 validation steps over this intent. Steps are counted the way the
  validator, which memoises nothing, spends them: each shape evaluation, value node and path
  step, including the path re-walks of `sh:equals`-style and qualified components and the
  members a property shape's `sh:and` re-runs over its own path. That pre-check models the
  validator, so the validator also runs under a hard budget of 20,000 graph operations (each
  match, quad read and report write, metered through its datasets): a validation that spends it
  stops and is refused, whatever drove the cost. Work the validator does on term text, outside
  any graph operation, is bounded by refusing terms over 4096 characters (a literal counted
  with its language tag and datatype IRI), language tags over 35, shape labels
  (`sh:message`, `sh:name`, `sh:description`) over 1024, and typed literals other than strings
  over 128 (their lexical patterns backtrack); `sh:lessThan`-style pairwise comparisons count
  as steps.
- In Node, validation uses a shared, lazily pre-warmed `worker_threads` pool, with
  **min(2, availableParallelism()) workers** and at most **64 waiting calls**. A full
  queue fails closed with `Validation worker queue is full`. Workers have V8 limits of
  64 MiB old generation, 16 MiB young generation and a 4 MiB stack (these are heap/stack
  limits, not a total process RSS limit). Idle workers are unref'd.
  Each call has a **2000 ms wall-clock deadline**, including input preflight, queue wait,
  worker startup, validation and report projection. Set `{ timeoutMs: 5000 }` to change
  it; `timeoutMs` must be an integer from 1 to 2147483647. Expiry returns
  `conforms: false` with `Validation exceeded <timeoutMs> ms wall-clock limit`. Active
  workers are terminated before the refusal settles, and replaced when more work is
  pending; terminated workers are never reused. Crashes, missing worker files and
  message deserialization failures also fail closed. Successful workers are reused.
  The calling thread checks raw graph counts (1000 intent / 10000 shape quads) and the
  shared term caps before conversion or serialization; dataset iteration and structured
  intent lowering are bounded too. Duplicate input quads count toward the raw limits.
  Transfer preserves blank nodes, named graphs, datatypes, languages and RDF 1.2 direction.
- Use `new ValidationWorkerPool({ size: 2, maxQueueSize: 32 })` and pass it as
  `{ workerPool }` to configure concurrency and queue capacity. `size` accepts 1–32;
  `maxQueueSize` accepts 0–65536. Call `await workerPool.close()` for graceful shutdown:
  it refuses pending calls and awaits termination. Closed instances cannot be reused.
  `await closeValidationPool()` closes the default shared pool; the next call creates
  another lazily. Pool construction rejects invalid pool configuration; `validateIntent`
  always returns a report.
- **Bundlers:** this package ships Node ESM with `dist/validationWorker.js` beside
  `dist/index.js`. esbuild/webpack may omit that relative worker file when bundling the
  main entry. Copy/emit the shipped worker as a separate Node ESM asset, retaining access
  to its external npm dependencies, and supply its absolute URL as
  `new ValidationWorkerPool({ workerUrl: new URL("file:///app/assets/validationWorker.js") })`.
  Alternatively supply `workerFactory: (url, options) => new Worker(url, options)` to
  integrate your bundler's worker creation. The factory must return a fresh Node-compatible
  Worker per invocation, apply the supplied `resourceLimits`, and run the shipped worker
  protocol: `{ ready: true }` once loaded, then `{ id, report }` for each
  `{ id, data, shapes }` request. Factories are trusted application configuration.
  Node builtins are loaded lazily. Runtimes with `nodejs_compat` but no usable
  `node:worker_threads` return a clear configuration diagnostic; there is no automatic
  fallback after a worker failure.
- **Weaker in-process option:** `{ execution: "in-process" }` explicitly opts into
  synchronous validation, retaining the step pre-check, term caps and 20,000-operation
  budget. It cannot interrupt unmetered synchronous work and has **no wall-clock bound**;
  `timeoutMs` cannot stop it. Browser environments use this metered path by default;
  `{ execution: "worker" }` requires a worker even outside detected Node environments.
  The package does not ship a browser Web Worker entry. Continue to await `validateIntent`
  in every environment.
- The deterministic NL parser reads verbs, ACL modes and recipient markers from the prose
  only, never from inside a URL.
- Handshake decoders accept only an http(s) `protocolSource` and `xsd:boolean` flags.

The package-local [SKILL.md](SKILL.md) records validation maintenance and build guidance.

## Vocabulary compatibility

Phase-1 writers keep emitting `https://w3id.org/jeswr/a2a#` intents, shapes, protocol
metadata and handshakes, preserving existing wire bytes and protocol hashes. Canonical
emission is deferred to phase 2 because pinned peers would reject it. Readers and
`validateIntent` accept `https://jeswr.org/ns/a2a#`, legacy and mixed vocabulary.

Validation uniformly renames every legacy A2A IRI in both data and shapes in a temporary
view, including subjects, graph names, resource values and SHACL expressions. It fails
closed if distinct legacy/canonical identity terms would collapse: subjects and objects
outside `rdf:type` are checked together. Pure predicate and class alias mixing is accepted.
Intent parsing reads that same normalized graph and returns `undefined` on identity
collisions; returned A2A instance/resource IRIs therefore use the canonical spelling.

`hashQuads` and `verifyProtocolDocument` still hash the original supplied IRIs exactly.
Caller-supplied shape bodies, response classes and protocol/shape identifiers remain
unchanged, including shapes already pinned by a hash. The published
`https://w3id.org/jeswr/a2a-rdf/v1` specification URLs remain unchanged.

## Links

- [Source](https://github.com/jeswr/solid-a2a)
- [Issues](https://github.com/jeswr/solid-a2a/issues)
- [SHACL](https://www.w3.org/TR/shacl/)
- [RDF Dataset Canonicalization](https://www.w3.org/TR/rdf-canon/)

## License

[MIT](./LICENSE) © Jesse Wright
