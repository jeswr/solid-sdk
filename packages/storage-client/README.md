<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-client

> **Experimental — AI-agent-generated.** The factory, types, errors, helpers, memory and HTTP backends, and offline HTTP fixture tools are implemented.

Protocol-neutral storage clients for Solid and LWS. Design of record: SDK core `ADR-003-storage-client.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

Entry points:

- `@jeswr/storage-client`: `createPodClient({ fetch, storage, capabilities?, backend?, clock?, signal? })`, the ADR-003 types (`StorageClient`, `ReadResult`, `Patch`, …), `StorageError` and `toStorageError`. The factory returns `{ storage, description, features }`, choosing Solid or LWS from discovery.
- `@jeswr/storage-client/errors`: the error model, plus `storageErrorFrom(method, url, response)`, which reads at most 64 KiB of an RFC 9457 body.
- `@jeswr/storage-client/helpers`: `retryOnConflict(fn, read, attempts = 3)` and an RFC 6902 `applyJsonPatch`.
- `@jeswr/storage-client/memory`: `createMemoryStorage({ protocol: 'solid' | 'lws', pageSize, moveResource, strictConditional })`, a full in-memory `StorageClient` for tests.
- `@jeswr/storage-client/solid`: `createSolidBackend({ fetch, root, features?, etagFollowUp? })` and `buildN3Patch({ inserts, deletes, where? })`. Solid moves use copy/delete emulation with rollback; ACLs and describedby metadata are not copied.
- `@jeswr/storage-client/lws`: `createLwsBackend({ fetch, root, storage?, features? })`, the LWS HTTP backend with scoped paging, conditional writes, and RFC 9264 metadata. `storage` defaults to `root`.
- `@jeswr/storage-client/testing`: Node-only `createRecordingFetch({ fetch, directory })` (enabled by `RECORD=1`), `loadFixtures(directory)`, and strict offline `createReplayFetch(fixtures)` with `assertDone()`. Recording removes Authorization, DPoP, Set-Cookie, Cookie and Proxy-Authorization headers from both persisted sides; bodies are base64 bytes. Use a fresh directory per recorded scenario; review URLs and bodies before committing captures.

```ts
import { createPodClient } from '@jeswr/storage-client';

const { storage } = await createPodClient({ fetch: authenticatedFetch, storage: storageRoot });
const { url, etag } = await storage.create(storage.root, 'first draft', { contentType: 'text/plain' });
if (etag === null) throw new Error('Read a validator before editing this resource');
await storage.write(url, 'second draft', { contentType: 'text/plain', ifMatch: etag });
```

All mutations except `create` require `ifMatch`. A name is exact on Solid and a hint on LWS.
See [SKILL.md](SKILL.md) for app usage and fixture workflows.

LWS writes require `ifMatch`; `'*'` on `write`/`writeRdf` sends `If-Match: *` and never
creates a missing resource. Use `create` for POST creation: `name` is a Slug hint, and the
returned URL comes from the server's Location, independently of the parent path.
Create parents and move destinations may use opaque identifiers without a trailing slash.

**LWS RDF patch is read-modify-write by default.** It checks the caller's ETag on the initial
read, applies inserts/deletes, and PUTs with that read's ETag. A 412 triggers one fresh read
and reapplication; a second 412 is returned. Advertised SPARQL Update is used only for the
resource's actual media type and default-graph patches. Named-graph patches retain RMW for
TriG/N-Quads. Variables and nonempty `where` clauses are unsupported.

LWS moves require MoveResource and update the linkset's `up` relation. `setMetadata` takes
the **metadata document's ETag**, and refuses server-managed `type`, `up`, and `linkset`.
Recursive deletion preflights logical containment and deletes children before containers, with
conditional requests throughout. `RecursiveDeleteService` availability does not establish
`Depth: infinity` support, so deletion retains client traversal even when that service is advertised.

Memory `writeRdf` defaults to Turtle and also supports `contentType: 'application/ld+json'`
through `@jeswr/rdf-serialize`, in both Solid and LWS protocol modes. JSON-LD output is an
expanded, context-free array, with named graphs, stable document-local blank-node labels and
literal lexical values preserved. Empty datasets produce `[]`. Prefixes are ignored, contexts
are never accepted or fetched, and malformed or directional literals reject with `TypeError`.
Turtle and N-Triples output behavior is unchanged. JSON-LD RDF patches still return 415.

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
