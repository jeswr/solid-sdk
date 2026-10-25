<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/rdf-engine

> **Experimental — AI-agent-generated.** Private at version 0.1.0 pending conformance.

Lazy single-document RDF operations over the prebuilt `@sparq-org/sparq@0.1.5`
WASM bundle. Requires Node.js >=24. The design of record is SDK core ADR-007.

```ts
import { createRdfEngine } from "@jeswr/rdf-engine/node";

const engine = createRdfEngine(); // no WASM import or initialization yet
try {
  const data = await engine.parse(turtle, "text/turtle", { baseIri: documentUrl });
  const report = await engine.validate(data, shapesTurtle);
  const canonical = await engine.canonicalize(data);
  const jsonld = await engine.serialize(data, "application/ld+json");
} finally {
  engine.dispose();
}
```

`ready()` is idempotent and shares initialization across engine instances and the
configured-URL and default initialization paths. The first initialization selects
the loader and WASM URL; later engines reuse it. Every operation calls `ready()`
automatically; a failed initialization can retry. `loaded` indicates successful
initialization. Disposal is terminal and idempotent, including during loading.
WASM modules remain cached by the JavaScript runtime; disposal does not unload
the shared module.

`parse` accepts strings or UTF-8 bytes and returns an RDF/JS `DatasetCore`
backed by n3. It retains no WASM store, and remains usable after engine disposal.
Each call assigns fresh blank-node identities while preserving links within the
document, so datasets from separate parses can be combined without label collisions.
The real engine rejects RDF triple terms and directional language literals with a
`TypeError` because its materialized RDF/JS representation does not support them.
Every temporary store is freed in `finally`, including when an operation throws.
Turtle, TriG, N-Triples, N-Quads and JSON-LD are supported. TriG, N-Quads and
JSON-LD preserve named graphs. Turtle and N-Triples serialization export the
default graph. `baseIri` resolves relative Turtle and TriG IRIs; TriG uses n3 for
base resolution because 0.1.5 has no dataset-preserving base loader.
For JSON-LD without graph syntax, `baseIri` sets the native document base, which
survives null context resets. Documents using graph syntax retain a surrounding
base context to preserve graph names. Combining `baseIri`, graph syntax and null
contexts throws `TypeError`: the pinned binding cannot preserve both the base
and graph names for that combination. The syntax check is conservative and also
examines JSON literal contents and context aliases.

`serialize` accepts a dataset or any quad iterable, plus optional `prefixes` and
`pretty`. Turtle, TriG and JSON-LD use Sparq's serializer; line formats use n3's
Writer. `validate` accepts data quads and either shapes quads or Turtle text;
SHACL evaluates a graph, folding named graphs into it. `canonicalize` delegates
to Sparq's RDFC-1.0 canonicalizer, including for blank nodes.

`createIndex()` currently provides the LocalIndex graph lifecycle: `put` replaces
a resource graph, `remove` deletes it, `has` tests graph membership, and `size`
counts deduplicated quads. `put` assigns the supplied absolute resource IRI to
every quad and copies its input. An explicitly stored empty graph remains present.
Dispose indexes explicitly, or dispose the owning engine to release all of them.
The real engine mirrors graph changes into its owned WASM store; the fake keeps
them in JavaScript memory. The shared contract tests replacement, isolation,
deduplication, empty graphs and disposal. Full SPARQL queries, snapshot/restore,
persistence and LRU eviction remain T-071, as assigned in the original task split.

After `ready()`, `features` reports the detected `serialize` and
`parseShaclCompact` methods in the installed bundle. A missing serializer throws
a descriptive error. Compact SHACL parsing is detected for future integration;
the current `validate` string argument is Turtle. Both methods are present in
0.1.5. Remote JSON-LD contexts and ODRL are absent from that published build;
remote context loading, policy evaluation and form derivation are outside T-070.

For browsers, copy the installed browser artifact into the app's static directory:

```sh
pnpm --filter @jeswr/rdf-engine run copy:wasm /absolute/path/to/app/public/wasm
```

The script emits `sparq-<content-hash>.wasm` and `manifest.json`. Serve the hashed
file with immutable caching and `Content-Type: application/wasm`. Use the manifest
filename and an absolute public asset base URL:

```ts
import { createRdfEngine, wasmUrl } from "@jeswr/rdf-engine/browser";

const engine = createRdfEngine({
  wasmUrl: wasmUrl(manifest.fileName, new URL("/wasm/", location.href)),
});
```

Without a public base, `wasmUrl(fileName)` resolves relative to `./wasm/` beside
the module. Vite consumers can also pass a `?url` import directly as `wasmUrl`.
The default entry supports an injected `loader`; WASM initialization remains lazy.
The browser entry initializes Sparq's shipped web binding with the configured URL
because 0.1.5's high-level `init()` does not accept a URL. The Node entry lazily
imports the shipped synchronous `wasm-node` binding and needs no hosted asset.

The testing entry never imports Sparq or loads WASM:

```ts
import { createFakeRdfEngine, FakeEngineUnsupportedError } from "@jeswr/rdf-engine/testing";

const engine = createFakeRdfEngine({
  validate: { conforms: true, results: [] },
});
```

The n3-backed fake parses and serializes Turtle, TriG, N-Triples and N-Quads.
For ground datasets, canonicalization is sorted, deduplicated N-Quads, which is
RDFC-1.0 for datasets without blank nodes. **JSON-LD parsing/serialization and
blank-node canonicalization throw the exported `FakeEngineUnsupportedError`.**
The fake does not perform SHACL validation: `validate` returns an injected report
or calls an injected `(data, shapes) => report | Promise<report>` function. Its
default is `{ conforms: true, results: [] }`. Use the real engine in tests that
need JSON-LD, SHACL semantics or blank-node canonicalization.

From the workspace root:

```sh
pnpm --filter @jeswr/rdf-engine run lint
pnpm --filter @jeswr/rdf-engine run build
pnpm --filter @jeswr/rdf-engine run typecheck
pnpm --filter @jeswr/rdf-engine run test
pnpm --filter @jeswr/rdf-engine run bench:bundle
```

The shared `contract.test.ts` runs on fake and real Node WASM engines.
`contract.real.test.ts` tests JSON-LD, SHACL and blank-node canonicalization.
The store lifetime test measures live owned stores with their actual `heapBytes()`
before and after repeated success/failure operations; linear WASM memory capacity
is not a leak counter because its allocator retains freed pages.

`bench/bundle.json` records the installed browser WASM at **3,909,895 bytes raw**
and **1,444,432 bytes gzip (level 9)**. The test checks both the record and ADR-007's
amended ceilings: **4,194,304 bytes raw**, **1,572,864 bytes gzip**. No lifecycle
scripts or local WASM builds are required. Coverage thresholds remain 90%.
