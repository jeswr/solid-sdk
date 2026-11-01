<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-client

> **Experimental — AI-agent-generated.** Types, errors, helpers, the in-memory backend, the Solid HTTP backend, and the LWS HTTP read side are implemented. LWS mutations follow.

Protocol-neutral storage clients for Solid and LWS. Design of record: SDK core `ADR-003-storage-client.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Entry points:

- `@jeswr/storage-client`: the ADR-003 types (`StorageClient`, `ReadResult`, `Patch`, …), `StorageError` and `toStorageError`.
- `@jeswr/storage-client/errors`: the error model, plus `storageErrorFrom(method, url, response)`, which reads at most 64 KiB of an RFC 9457 body.
- `@jeswr/storage-client/helpers`: `retryOnConflict(fn, read, attempts = 3)` and an RFC 6902 `applyJsonPatch`.
- `@jeswr/storage-client/memory`: `createMemoryStorage({ protocol: 'solid' | 'lws', pageSize, moveResource, strictConditional })`, a full in-memory `StorageClient` for tests.
- `@jeswr/storage-client/solid`: `createSolidBackend({ fetch, root, features?, etagFollowUp? })` and `buildN3Patch({ inserts, deletes, where? })`. Solid moves use copy/delete emulation with rollback; ACLs and describedby metadata are not copied.
- `@jeswr/storage-client/lws`: `createLwsBackend({ fetch, root, storage?, features? })`, the LWS HTTP read side with scoped paging and RFC 9264 metadata. `storage` defaults to `root`.
- `@jeswr/storage-client/testing`: reserved for recorded fixtures.

```ts
import { createMemoryStorage } from '@jeswr/storage-client/memory';

const storage = createMemoryStorage({ protocol: 'lws', pageSize: 2 });
const { url, etag } = await storage.create(storage.root, '{"a":1}', { contentType: 'application/json' });
await storage.patch(url, { kind: 'json', ops: [{ op: 'replace', path: '/a', value: 2 }] }, { ifMatch: etag! });
```

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
