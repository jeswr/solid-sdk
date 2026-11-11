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
- `@jeswr/storage-client/solid`: `createSolidBackend({ fetch, root, features?, etagFollowUp? })` and `buildN3Patch({ inserts, deletes, where? })`. Solid moves use copy/delete emulation with rollback; emulated moves drop ACLs and do not copy describedby metadata. ACL-preserving moves belong to pod-access (SDK-APP-04).
- `@jeswr/storage-client/lws`: `createLwsBackend({ fetch, root, storage?, features? })`, the LWS HTTP backend with scoped paging, conditional writes, and RFC 9264 metadata. `storage` defaults to `root`.
- `@jeswr/storage-client/testing`: Node-only `createRecordingFetch({ fetch, directory })` (enabled by `RECORD=1`), `loadFixtures(directory)`, and strict offline `createReplayFetch(fixtures)` with `assertDone()`. Recording removes Authorization, DPoP, Set-Cookie, Cookie and Proxy-Authorization headers from both persisted sides; bodies are base64 bytes. Use a fresh directory per recorded scenario; review URLs and bodies before committing captures.

```ts
import { createPodClient } from '@jeswr/storage-client';

const { storage } = await createPodClient({ fetch: authenticatedFetch, storage: storageRoot });
const { url, etag } = await storage.create(storage.root, 'first draft', { contentType: 'text/plain' });
if (etag === null) throw new Error('Read a validator before editing this resource');
await storage.write(url, 'second draft', { contentType: 'text/plain', ifMatch: etag });
```

Memory `writeRdf` defaults to Turtle and also supports `contentType: 'application/ld+json'`
through `@jeswr/rdf-serialize`, in both Solid and LWS protocol modes. JSON-LD output is an
expanded, context-free array, with named graphs, stable document-local blank-node labels and
literal lexical values preserved. Empty datasets produce `[]`. Prefixes are ignored, contexts
are never accepted or fetched, and malformed or directional literals reject with `TypeError`.
Turtle and N-Triples output behavior is unchanged. JSON-LD RDF patches still return 415.
The Solid and LWS HTTP backends support mutations; their JSON-LD writes remain unsupported.

`readRdf` reports `StorageError('not-rdf')` for non-RDF or unparsable bodies and for HTTP
406 or 501 responses to its GET on both backends, preserving the status, URL, method and
problem details; other operations retain their usual HTTP error mapping.

All mutations except `create` require `ifMatch`. A name is exact on Solid and a hint on LWS.
See [SKILL.md](SKILL.md) for app usage and fixture workflows.

`head`, `list`, and `listAll` accept `{ revalidate: true }` to revalidate cached HTTP
responses before using them (`cache: 'no-cache'`). `listAll` applies it to every page.
Omitting the option preserves the transport's default cache behavior.

`list` and `listAll` also accept `{ maxBytes }`: a non-negative safe integer limiting
the actual response bytes **per page**, before RDF/JSON parsing. Exact limits are accepted;
invalid limits throw `TypeError`. An oversized or endless body is cancelled as soon as it
crosses the cap and rejects with a non-retryable `StorageError` whose `code` is
`payload-too-large` and whose message names the byte cap. No entries from the rejected page
are returned. `listAll` can already have yielded earlier, complete pages; consumers must
propagate failures instead of treating an incomplete listing as authoritative. LWS retains
its independent 16 MiB JSON hard limit (`invalid-response`), even if `maxBytes` is higher.
Omitting `maxBytes` preserves existing backend limits. Memory checks the UTF-8 bytes of its
container representation (the same body as `read`), including empty-container overhead.

`read`, `head`, `list`, and `listAll` accept additional `headers` for request-local
transport markers. Listings forward them on every page. Accept, Range and
If-None-Match remain controlled by the operation's dedicated options.

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

### Keepalive writes and display names

`WriteOptions` and `CreateOptions` accept `keepalive?: boolean`, forwarded to the injected
fetch for `write`, `writeRdf` and `create`. Browsers cap keepalive bodies at **64 KiB**.
The client measures encoded bytes (UTF-8 for strings, the view's byte length for Uint8Array,
and Blob.size), accepts exactly 65,536 bytes and rejects larger or unknown-size bodies with
non-retryable `StorageError('bad-request')` before sending. ReadableStreams and Blobs without
a known finite size are refused with keepalive. Callers can fall back to their outbox.
Omitting keepalive retains ordinary streaming and upload behavior; the memory backend
applies the same body-size check.

`MetadataOp.title?: string` carries a display title when the server chooses a different
identifier from the requested name. On LWS, an add writes RFC 9264's `title` target attribute;
adding an existing href with a title updates that attribute and retains the others. On Solid,
an add sets `dct:title` on the anchor in its describedby document, through the existing N3
Patch builder. Empty titles are valid. A remove still removes matching hrefs on LWS; on
Solid, supplying title also removes that exact title literal from the anchor. Use the
metadata document's ETag for these edits.

Every listing `Entry` now has `displayName: string | null`: LWS reads the listing target's
`title`, Solid reads the member's `dct:title` in the container listing. Missing or malformed
fields are null; no extra metadata requests are made. `displayNameOf(entry)`, exported from
both the package root and `./helpers`, returns `displayName ?? decodedLastPathSegment`.
It removes a container's trailing slash before choosing the segment and keeps the raw segment
when percent decoding fails. An empty displayName remains empty.

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

## Optional service clients (SDK-APP-12)

```ts
import { createTrashClient } from '@jeswr/storage-client/trash';
import { createVersionsClient } from '@jeswr/storage-client/versions';

const trash = createTrashClient(storage);
const versions = createVersionsClient(storage);
const [version] = await versions.versions(url); // url, at, etag
if (version) await versions.restoreVersion(url, version.url);
const copy = await trash.trash(url);
const entries = await trash.listTrash(); // url, original, trashedAt, size, contentType
const restored = await trash.restore(copy.url); // use returned url, especially on LWS
```

`./trash` exports `createTrashClient(storage)` with `trash(url)`, `listTrash()`,
`restore(trashedUrl)` and `purge(trashedUrl)`. Mutation results are `WriteResult`;
list rows contain `url`, `original`, `trashedAt: Date`, `size`, `contentType`.
Trashing is a server move via a JSON command POST, not client copy/delete. Restore
uses the server Location (the original URL on Solid, a new identifier on LWS).
Purge verifies trash membership, HEADs the copy and sends conditional DELETE to permanently remove it.

`./versions` exports `createVersionsClient(storage)` with `versions(url)` returning
`{ url, at: Date, etag }[]`, and `restoreVersion(url, versionUrl)` returning
`WriteResult`. Histories use a scoped version-history Link when advertised, otherwise
the one-variable `{resource}` endpoint template with a percent-encoded absolute URL.
Query-based template listings are accepted only for that advertised template and a
scoped resource. Encoded slashes in paths remain refused; use a query template or a
safe version-history Link. Each version must expose `ReadResult.mementoDatetime`,
which contains the server's Memento-Datetime header as a Date.
Restore verifies membership, reads a usable strong live ETag, and writes version bytes
with that If-Match; it never substitutes the version ETag or retries a 412.

Both clients require their respective feature state to be available and an endpoint;
unknown/unavailable/missing endpoint fails unsupported before any I/O. All service
URLs and returned Locations retain the ordinary scope rules. The public create
operation at the advertised TrashService endpoint accepts JSON resource/restore
commands, bypassing ordinary child creation rules only there. Restore allows 200/201,
and Location may identify a live resource outside the trash container. Ordinary create
behavior is unchanged. Retention is server policy, advertised as ssd:retention xsd:duration;
clients do not expire entries locally.

Memory flags `trash` and `versioning` default false and enable the services independently.
Enabled services use ordinary list/read/metadata/create/delete operations. Content creates,
writes and patches record immutable snapshots; reads and failed writes do not. Version nodes
and history containers reject mutations. Tests must cover disabled features as well as both
protocols. See the [appendix contribution](../../docs/specs/service-description/trash-and-versions-appendix.md)
for the full protocol and three examples.
