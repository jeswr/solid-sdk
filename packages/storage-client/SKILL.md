---
name: storage-client
description: Use when reading, creating, conditionally editing, listing or moving pod resources with @jeswr/storage-client, or maintaining its Solid/LWS backends and offline fixtures.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-client

## Quick reference

Apps import `createPodClient` from `@jeswr/storage-client`. Inject the authenticated, guarded
fetch supplied by the auth layer; discovery and storage operations use that same transport.
Pass a storage root or a resource inside it. The factory resolves a `StorageDescription`,
derives features through `capabilities()` (including cached Solid probes), and picks the
backend from `description.protocol`. It returns `{ storage, description, features }`;
`storage.features` is the same features object. Discovery errors propagate without guessing
a backend. Apps should use this root API; direct `./solid` and `./lws` imports are for backend
work and tests (the SDK layer guard disallows app manifest edges to those subpaths).

```ts
import { createPodClient } from '@jeswr/storage-client';

declare const authenticatedFetch: typeof fetch; // Inject pod-auth auth.fetch.
declare const storageRoot: string;
declare const signal: AbortSignal;

const { storage, features } = await createPodClient({
  fetch: authenticatedFetch,
  storage: storageRoot,
  signal,
});
const created = await storage.create(storage.root, 'first draft', {
  name: 'note.txt', contentType: 'text/plain',
});
const current = await storage.head(created.url);
if (current.etag === null) throw new Error('A validator is required to edit this resource');
await storage.write(created.url, 'second draft', {
  contentType: 'text/plain', ifMatch: current.etag,
});
```

Read [LWS app differences](../../skills/lws-vs-solid/SKILL.md) before assuming path containment,
permission headers or recursive notifications. Use [pod-notifications](../pod-notifications/SKILL.md)
for changes; [pod-access](../pod-access/SKILL.md) provides WAC/ACP and LWS ODRL sharing/requests.
Availability describes server support, not caller permission.

`capabilities` in the factory options is an optional `DescriptionCache`, shared with other
capability consumers; the default is the capabilities package's shared in-memory cache.
`clock` supplies discovery/cache time. `signal` covers client creation; pass operation signals
separately for subsequent reads/writes. `backend` explicitly forces an implementation for
diagnostics/tests; description and features still report discovery evidence, so it is not a
way to advertise capabilities the server lacks. All storage operation URLs remain absolute
and scoped to `description.root`; an LWS storage id never authorises a foreign fetch.

### Conditional mutations and returned URLs

- `write`, `writeRdf`, `patch`, `move`, `delete`, and `setMetadata` require a nonempty `ifMatch`.
  Keep ETags verbatim. Re-read after a 412 (`StorageError.code === 'precondition-failed'`);
  `./helpers` provides `retryOnConflict` for callers that can safely reapply their change.
- Only `write` and `writeRdf` accept `'*'`: Solid sends no precondition; LWS sends
  `If-Match: *` and still returns 404 when the resource is absent. Prefer the observed ETag
  for edits. `create` needs no `ifMatch` because it creates a new resource.
- `setMetadata` takes the metadata document's ETag from `storage.metadata(url)`, rather than
  the content ETag. A write result may have `etag: null` if a committed mutation omitted it
  and its follow-up HEAD failed; read again before the next conditional mutation.
- With `create(container, body, { name })`, Solid PUTs an exact encoded child name with `If-None-Match: *`;
  a taken name gives `conflict`. LWS POSTs with `Slug` as a hint, and the server decides the
  identifier. Without a name, both use POST. Always use the returned `url`, including after
  moves; never construct a resource URL from a hint. LWS move ignores `name`.

**LWS RDF patch is read-modify-write by default:** read the RDF and check the caller's initial
ETag, apply inserts/deletes locally, then PUT with that read's ETag. On 412 the backend re-reads
and reapplies once against the newer state; a second 412 propagates. This can merge a patch
into newer content, so callers needing strict rejection of all intervening edits should use
an explicit conditional `writeRdf` instead. Advertised SPARQL Update is used only for the actual
resource media type and default-graph patches; named-graph patches retain RMW. Variables and
nonempty `where` are unsupported. LWS stores RDF bodies as opaque content.

### Offline fixtures (`./testing`, Node only)

`createRecordingFetch({ fetch, directory })` returns the original transport unless `RECORD=1`
at construction. When enabled it buffers bodies, forwards the effective Request, and writes
one version-1 JSON pair per request as `000001.json`, `000002.json`, etc., in invocation order.
Use a fresh scenario directory for each recorder; files are created exclusively, never
silently overwritten. Conformance runners can target
`packages/storage-client/testing/fixtures/<target>/<scenario>/`. Package tests use temporary
directories and synthetic CSS/sparq exchanges; no live server is needed.

Headers are normalised; Authorization, DPoP, Set-Cookie, Cookie and Proxy-Authorization are
omitted case-insensitively from both persisted sides. Live requests/responses retain those
headers. Bodies use base64 to preserve arbitrary bytes; null means no body, distinct from
empty bytes. This is header redaction only: use public/synthetic body and URL data for fixtures,
and inspect captures before committing them.

```ts
import {
  createRecordingFetch, createReplayFetch, loadFixtures,
} from '@jeswr/storage-client/testing';
import { createPodClient } from '@jeswr/storage-client';
import { createMemoryCache } from '@jeswr/storage-capabilities/cache';

declare const authenticatedFetch: typeof fetch;
declare const directory: string; // Fresh directory containing synthetic/public fixture data.
declare const storageRoot: string;
const freshCache = createMemoryCache();

const recordedFetch = createRecordingFetch({ fetch: authenticatedFetch, directory });
// In RECORD=1 mode, inject recordedFetch into the conformance client's factory.
// In offline tests, inject the replay instead:
const replay = createReplayFetch(await loadFixtures(directory));
const client = await createPodClient({ fetch: replay, storage: storageRoot, capabilities: freshCache });
// Run the recorded scenario using client.storage, then prove all pairs were consumed:
replay.assertDone();
```

Replay checks method, URL, public headers and exact request bytes in order, ignoring credential
headers. Extra requests, mismatches, corrupt fixtures and unused entries fail; no network
fallback exists. Mismatches do not consume entries and never echo request/header/body data.
Responses preserve recorded URLs, redirect flags, status and bytes. Match discovery/cache state
and generated names to the recording; use deterministic name hints in reproducible tests.

T-020 implements the ADR-003 §1 types (`src/types.ts`, re-exported as types from the root), the
§2 error model (`StorageError`, pure `toStorageError(method, url, response, bodyText?, now?)`,
`storageErrorFrom` that reads at most 64 KiB of a JSON/problem body), `./helpers`
(`retryOnConflict`, which re-reads before every retry, plus the in-house RFC 6902 `applyJsonPatch`),
and `./memory` (`createMemoryStorage({ protocol, root, pageSize, moveResource, strictConditional, clock })`).
T-021 adds the Solid backend's read side; T-022 adds its mutations. `./solid` exports
`createSolidBackend({ fetch, root, features?, etagFollowUp? })` and the pure async
`buildN3Patch({ inserts, deletes, where? })`. T-023 adds `./lws` →
`createLwsBackend({ fetch, root, storage?, features? })`. T-024 adds conditional LWS mutations
in `src/lws-write.ts`. T-025 adds `createPodClient` and the Node-only recorder/replayer in `./testing`.

Solid read side (ADR-003 §6):
- Every URL must be absolute: its standalone parse (`new URL(url)`, without a base) must pass
  guarded-fetch `assertWithinPodScope(root, …)` and equal the root-based resolution of the input;
  otherwise `scope`, before any request, on both backends. This rejects ambiguous same-scheme
  references (`https:host/path`, `https:/path` and their backslash variants), redacting credentials
  from errors and causes. The canonical scoped URL is always fetched, including cursor pages;
  opaque query spelling/order survives canonicalisation. Solid scopes supplied cursors before
  rejecting them with `bad-request` (one page). Redirects are never followed
  (`redirect: 'manual'`; a 3xx is `invalid-response`). Transport failures are retryable `network`
  errors; aborts are non-retryable `network` errors.
- `list` GETs Turtle and reads `ldp:contains` through `@solid/object`'s `Container`, with a local
  `Resource` subclass for `dct:format`. Members outside the storage or not directly contained are
  dropped (fail closed). Kind comes from `ldp:(Basic)Container` or a trailing slash, contentType
  from a valid `dct:format` literal or the IANA media-type class, size from `posix:size`, modified
  from `dc:modified`, else `posix:mtime` (epoch seconds). Non-IRI `rdf:type` objects and malformed
  fields are dropped, never the member. Items are
  sorted by URL. A non-container is `method-not-allowed`.
- `list` / `listAll` accept `ListingOptions.maxBytes`, a non-negative safe integer response-byte
  cap per page. Invalid caps throw `TypeError` before fetching; zero is a real cap and exact limits
  succeed. Both HTTP backends reuse `http.ts`'s `boundedText` reader (extracted from LWS JSON
  collection), counting actual streamed bytes before decoding/parsing and cancelling overflow
  without awaiting cancellation. Overflow is non-retryable `StorageError('payload-too-large')`
  with the page URL and cap in its message; no entries from that page escape. Consumers of
  `listAll` must propagate later-page failures even after receiving complete earlier pages.
  Omitting the option keeps existing backend limits; raising it never raises LWS's 16 MiB hard cap.
  Memory measures the same UTF-8 container representation as `read`, including empty listings.
- `head`/`read` use `Link` (context = the response URL; anchored links ignored) for `type`,
  `describedby` → `metadataUrl`, WAC-Allow `user` → `allow`, and path arithmetic for `parent`.
  `read` sends Accept, If-None-Match and `Range: bytes=…` (206). Only 200, a requested 206 and a
  conditional 304 succeed; any other 2xx/3xx is `invalid-response`. `body` is the live stream;
  `bytes()/text()/blob()` buffer that same stream once (use one or the other). A body failing
  mid-transfer is a `network` error on both paths (non-retryable once the signal aborted).
- Scope errors redact embedded credentials of the target and the root in every authority
  spelling (backslashes included). `list()` refuses a URL with a query or fragment
  (`bad-request`), except a query matching the advertised version-history template for a scoped
  resource. Fragments remain refused. `kind` follows the path (never the query), and the slashless
  root alias is the root even with a query or fragment (`parentOf` → null).
  Both network backends' `listAll()` scope, canonicalise and validate the container exactly as
  `list()` before pagination checks aborts, so even an already-aborted signal cannot expose raw
  container credentials in errors. Pagination receives only the canonical container and cursors.
- `readRdf` accepts `text/turtle, application/ld+json;q=0.9`, maps 304 to `notModified`, and
  reports a non-RDF or unparsable body as `not-rdf`. On both HTTP backends, its GET also maps
  406 or 501 to `not-rdf`, preserving status, URL, method and problem details; other operations
  retain their usual HTTP error mapping. `metadata` reads the `describedby` document as RDF
  (`unsupported` when none is advertised).
- `Link` and WAC-Allow parsing reuse `@jeswr/storage-capabilities` (`parseLinkHeaders`,
  `parseWacAllow`). Both backends parse authoritative Link headers with explicit overflow rejection:
  at most **64 KiB UTF-8 per combined field value**, **1,024 nonempty members** (including malformed
  members), and **1 MiB of cumulative resolved target + anchor context URL lengths**, measured in
  UTF-16 code units before retaining each member. Every retained member counts both URLs, including
  duplicates and the response URL used when no anchor is supplied. Overflow gives `invalid-response`
  and discards the body before storage validation or type, next, describedby, up or linkset discovery
  can use partial results. Exact limits are accepted.
  Repeated relation tokens within one member add only one target per relation; separate members
  retain their order and duplicates. Targets append without copying earlier entries.

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

## LWS read side

LWS reads use scoped opaque identifiers, paginated JSON listings and linkset metadata;
storage-id links never authorise a request outside the root. Read the
[LWS read protocol details](references/lws-read.md) before changing discovery validation,
read/list/metadata handling, pagination or response size limits.

## LWS write side

LWS mutations use conditional writes, server-assigned create identifiers, linkset metadata
patches and logical containment for moves and recursive deletion. Read the
[LWS write protocol details](references/lws-write.md) before changing any LWS mutation,
including RDF patch retries, ETag handling or move/delete preflight.

## Solid write side

Solid mutations use conditional HTTP requests and N3/SPARQL patches; moves emulate copy
and delete with preflight and conditional rollback. Read the
[Solid write protocol details](references/solid-write.md) before changing mutations,
patch serialization, recursive deletion, move safety or describedby metadata updates.

Rules the memory backend enforces, and the real backends must match:
- Every mutation (`write`, `writeRdf`, `patch`, `setMetadata`, `move`, `delete`) needs `ifMatch`
  (TypeError otherwise, unless `strictConditional: false`, where Solid proceeds and LWS answers
  428). `'*'` is accepted only by `write`/`writeRdf` (ADR-003 §3); elsewhere it is a TypeError. On
  Solid, `'*'` means no precondition. On LWS it is `If-Match: *`, and PUT never creates (404).
- Mutations are applied one at a time, so an ETag check and its commit are never split by another
  mutation, and concurrent creates never share a URL. Reads snapshot the node before any await, so
  bytes and ETag always describe the same state. An abort while a body is being collected cancels
  the stream and nothing is committed; a queued mutation whose signal fires rejects at once. A
  failing body stream is a non-retryable `network` error. Only canonical, IRI-safe URLs are
  accepted (`bad-request` otherwise).
- Every serialisation escapes IRIREF-forbidden characters in IRIs and prefix namespaces
  (`escapeIri`), relabels unsafe blank-node labels and refuses malformed language tags and prefix
  names (exact Turtle `PN_PREFIX`), so crafted terms can never forge triples. Every term is rebuilt with n3's DataFactory from its
  RDF/JS fields only (a foreign term's own `id` is never written; non-string fields are a TypeError). Prefixes are only
  cosmetic: a dotted prefix name, one that some IRI starts with (`name:`), or a namespace containing
  `[` (IPv6 hosts) is silently dropped.
  Variables (N3 Patch only) are rebuilt the same way.
  Moving a resource rewrites metadata anchors on that resource and its fragments only. `listAll` stops between entries once aborted.
- A stale ETag gives `precondition-failed` (412) with the current `etag`. ETags change on every write,
  and a container's ETag changes only on membership changes.
- LWS lists in pages (`next` cursors are opaque), Solid lists in one page. `listAll` refuses a
  repeated page and stops at 10 000 pages. A raw LWS container `read` returns the same page with a
  `next` link, and the `container?page=N` URL is readable.
- RDF patch applies inserts/deletes atomically, and a missing deletion is a 409 `conflict`. Named
  graphs are refused (422) for Turtle / N-Triples resources, and `writeRdf` throws a TypeError
  rather than labelling graph blocks as Turtle.
  `where` is `unsupported` in memory. JSON Patch applies to JSON resources only.
- Solid moves are copy+delete emulation (new URL, capped at 2 000 resources) and drop ACLs.
  ACL-preserving moves belong to pod-access (SDK-APP-04). LWS moves need
  MoveResource (`unsupported` with `feature: 'move'` otherwise), and the server picks the name.
- LWS `setMetadata` refuses the server-managed rels `linkset`, `type` and `up`. Solid rels that are
  not IRIs map to `http://www.iana.org/assignments/relation/<rel>`.
- `readRdf` with a matching `ifNoneMatch` resolves with `notModified: true` and an empty dataset
  (an extension to ADR-003's `RdfReadResult`). Memory `writeRdf` serialises the n3-writable formats
  and `application/ld+json` through `@jeswr/rdf-serialize`. JSON-LD is an expanded, context-free
  array (`[]` for an empty dataset), with document-local blank-node labels, named graphs and
  literal lexical values preserved. Prefixes are ignored; no caller context is accepted and no
  remote context is emitted or fetched. Malformed terms and directional literals (including
  `rdf:dirLangString`) reject with `TypeError`. JSON-LD RDF patch support is unchanged (415).
  The Solid and LWS HTTP backends support mutations; their JSON-LD writes remain unsupported.

RDF/JS types (`DatasetCore`, `Quad`, `Term`) come from `@jeswr/fetch-rdf`'s type re-exports, so the
emitted declarations need no `@rdfjs/types` dependency (which the layer guard does not allow).

Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/` and this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial tests with the implementation.
Keep dev tool versions aligned with the root. pnpm 10.4.1 with `ignore-scripts` requires
local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.

## Optional trash and version clients (SDK-APP-12)

`./trash` → `createTrashClient(storage)`; `./versions` → `createVersionsClient(storage)`. Both require advertised available features and scoped endpoints.
Read [optional service client guidance](README.md#optional-service-clients-sdk-app-12) for API contracts, query templates, conditional restores, memory flags and the protocol appendix.
