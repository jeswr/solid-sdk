<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/storage-client

> **Experimental — AI-agent-generated.** Types, errors, helpers and the in-memory backend are implemented; the Solid and LWS HTTP backends follow.

Protocol-neutral storage clients for Solid and LWS. Design of record: SDK core `ADR-003-storage-client.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Entry points:

- `@jeswr/storage-client`: the ADR-003 types (`StorageClient`, `ReadResult`, `Patch`, …), `StorageError` and `toStorageError`.
- `@jeswr/storage-client/errors`: the error model, plus `storageErrorFrom(method, url, response)`, which reads at most 64 KiB of an RFC 9457 body.
- `@jeswr/storage-client/helpers`: `retryOnConflict(fn, read, attempts = 3)` and an RFC 6902 `applyJsonPatch`.
- `@jeswr/storage-client/memory`: `createMemoryStorage({ protocol: 'solid' | 'lws', pageSize, moveResource, strictConditional })`, a full in-memory `StorageClient` for tests.
- `@jeswr/storage-client/solid`, `/lws`, `/testing`: reserved for the HTTP backends and recorded fixtures.

```ts
import { createMemoryStorage } from '@jeswr/storage-client/memory';

const storage = createMemoryStorage({ protocol: 'lws', pageSize: 2 });
const { url, etag } = await storage.create(storage.root, '{"a":1}', { contentType: 'application/json' });
await storage.patch(url, { kind: 'json', ops: [{ op: 'replace', path: '/a', value: 2 }] }, { ifMatch: etag! });
```

Memory `writeRdf` defaults to Turtle and also supports `contentType: 'application/ld+json'`
through `@jeswr/rdf-serialize`, in both Solid and LWS protocol modes. JSON-LD output is an
expanded, context-free array, with named graphs, stable document-local blank-node labels and
literal lexical values preserved. Empty datasets produce `[]`. Prefixes are ignored, contexts
are never accepted or fetched, and malformed or directional literals reject with `TypeError`.
Turtle and N-Triples output behavior is unchanged. JSON-LD RDF patches still return 415;
Solid HTTP mutations remain pending T-022 and LWS HTTP remains reserved in this checkout.

From the workspace root:

```sh
pnpm --filter @jeswr/storage-client run lint
pnpm --filter @jeswr/storage-client run build
pnpm --filter @jeswr/storage-client run typecheck
pnpm --filter @jeswr/storage-client run test
```

Coverage is enabled with 100% thresholds for branches, functions, lines, and statements. The tests
include the RFC 6902 Appendix A examples, a table over every `StorageErrorCode`, and fast-check
properties for the memory backend (ADR-003 §10).
