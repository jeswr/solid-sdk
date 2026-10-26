---
name: storage-client
description: Work on @jeswr/storage-client, the protocol-neutral storage clients for solid and lws package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-client

T-020 implements the ADR-003 §1 types (`src/types.ts`, re-exported as types from the root), the
§2 error model (`StorageError`, pure `toStorageError(method, url, response, bodyText?, now?)`,
`storageErrorFrom` that reads at most 64 KiB of a JSON/problem body), `./helpers`
(`retryOnConflict`, which re-reads before every retry, plus the in-house RFC 6902 `applyJsonPatch`),
and `./memory` (`createMemoryStorage({ protocol, root, pageSize, moveResource, strictConditional, clock })`).
T-021 adds the Solid backend's read side: `./solid` exports
`createSolidBackend({ fetch, root, features? })`. T-023 adds `./lws` →
`createLwsBackend({ fetch, root, storage?, features? })`. `./testing` is still reserved (T-025);
Solid mutations reject with `unsupported` until T-022, LWS mutations until T-024.

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
- `head`/`read` use `Link` (context = the response URL; anchored links ignored) for `type`,
  `describedby` → `metadataUrl`, WAC-Allow `user` → `allow`, and path arithmetic for `parent`.
  `read` sends Accept, If-None-Match and `Range: bytes=…` (206). Only 200, a requested 206 and a
  conditional 304 succeed; any other 2xx/3xx is `invalid-response`. `body` is the live stream;
  `bytes()/text()/blob()` buffer that same stream once (use one or the other). A body failing
  mid-transfer is a `network` error on both paths (non-retryable once the signal aborted).
- Scope errors redact embedded credentials of the target and the root in every authority
  spelling (backslashes included). `list()` refuses a URL with a query or fragment
  (`bad-request`), `kind` follows the path (never the query), and the slashless root alias is the root even with a query or fragment (`parentOf` → null).
- `readRdf` accepts `text/turtle, application/ld+json;q=0.9`, maps 304 to `notModified`, and
  reports a non-RDF or unparsable body as `not-rdf`. `metadata` reads the `describedby` document as
  RDF (`unsupported` when none is advertised).
- `Link` and WAC-Allow parsing reuse `@jeswr/storage-capabilities` (`parseLinkHeaders`,
  `parseWacAllow`). Both backends parse authoritative Link headers with explicit overflow rejection:
  at most **64 KiB UTF-8 per combined field value** and **1,024 nonempty members** (including malformed
  members). Overflow gives `invalid-response` and discards the body before storage validation or
  type, next, describedby, up or linkset discovery can use partial results. Exact limits are accepted.

## LWS read side

- `root` is a scoped HTTP(S) StorageRoot container URL ending `/`, without query/fragment
  (including empty delimiters); malformed container roots throw TypeError, unsafe roots `scope`,
  like Solid. `storage` is StorageDescription.id; default `root`: sparq's `LwsConfig::storage()`
  returns the root and its lws#storage link names that URL (`src/lws/mod.rs:421-425`,
  `src/lws/resources.rs:684-704`). Normalise `storage` once with `new URL(storage).href`; non-absolute
  or non-HTTP(S) ids throw TypeError. Link comparisons use that normalised id, so equivalent URL
  spellings match. `features` defaults to `deriveFeatures` for an undescribed LWS
  storage (empty services/capabilities, probe source), or retains the supplied Features object.
- Design call: `isWithinStorage` is the synchronous guarded-fetch root-prefix check, like Solid.
  Every request must pass `scoped(root, …)` before fetch; storage-id equality never authorises an
  authenticated request outside the root, narrowing ADR-003's non-path-aligned identifier rule.
  On every response (HEAD, read, readRdf, list, metadata), ANY lws#storage link in the response URL's
  context that differs from `storage` gives `scope` and discards the body. Matching/absent links
  are accepted; links with a different anchor context are ignored. Errors never echo the foreign id.
- `list` takes a scoped container ending `/`, without query/fragment (even empty `?`/`#`), else
  `bad-request`. GET Accept: `application/lws+json, application/ld+json;q=0.5`. Cursors are scoped
  first, then fetched as canonical URLs with opaque queries preserved. Only 200 succeeds; other 2xx/3xx are
  `invalid-response`, HTTP errors use the shared mapping, redirects are never followed.
- Listing media type must be lws+json or ld+json. JSON is capped at **16 MiB of streamed bytes**
  for listings and linksets, independently of Content-Length; overflow/bad JSON → `invalid-response`.
  Top level must be an object, type (string/array) includes Container or ContainerPage (compact or
  full https://www.w3.org/ns/lws# IRI), and items must be an array. sparq's ordinary pages all use
  Container; type-search pages use ContainerPage (`src/lws/index.rs:625-675`). Each item must be an
  object with string id; malformed structure → `invalid-response`. Resolve ids against response
  URL; drop invalid, non-HTTP(S), unsafe or foreign ids; duplicate resolved ids keep the first.
- Entry order follows the server. Kind depends only on Container type, never a trailing slash.
  Content type is valid RFC 6838 `format` (shared MEDIA_TYPE with Solid), null for containers;
  size is a non-negative safe integer; modified is a parseable date string; else null. Types retain
  only absolute IRIs, excluding compact/full Container and DataResource; malformed optional fields
  drop only that field. `total` is non-negative safe-integer totalItems or null; etag is verbatim.
  `next` uses the first response-context next Link, resolved against that URL; foreign/unsafe or
  self links → `invalid-response`. `listAll` uses shared paginate: loop guard, 10,000 pages maximum,
  abort between entries. No client sorting or cursor reconstruction.
- HEAD/read/readRdf share status, GET/HEAD headers, range validation, conditional 304, body buffering,
  transport/abort mapping and RDF parsing with Solid (`src/read.ts`, `src/http.ts`). Accept defaults
  to */*, readRdf to `text/turtle, application/ld+json;q=0.9`; 304 gives an empty dataset and
  notModified, non-RDF/unparsable RDF → `not-rdf`. Only requested 206 and conditional 304 succeed.
  Parent is the first `up` link only if scoped, metadataUrl the first scoped `linkset` link, else
  null; do not fall through to a later safe link. Root parent is always null, root kind container;
  other kinds use ONLY the exact https://www.w3.org/ns/lws#Container type link. allow is always null.
- `metadata` does one HEAD, then GET metadataUrl with Accept application/linkset+json; absent/suppressed
  linkset → `unsupported`. Accept application/linkset+json or application/json only. RFC 9264 §4.2:
  object with linkset array of context objects, each with string anchor, all other keys relation
  arrays of target objects with string href; malformed structure/reference → `invalid-response`.
  Resolve anchors/hrefs against the linkset URL. Anchors must be HTTP(S), foreign anchors are kept
  as data and never fetched; hrefs may name other absolute schemes. Duplicate anchors/relations
  merge in order. Params keep only string-valued attributes except href; array attributes including
  hreflang/title* are skipped (preserved in raw). raw is parsed JSON, url is the fetched linkset URL,
  etag is its ETag. Maps and own-property params preserve hostile property names as data.
- `parentOf` scopes first; root → null without a request, otherwise one HEAD returning parent.
  write/writeRdf/create/patch/move/delete/setMetadata reject `unsupported` without fetching (T-024).
  Fixtures in src/fixtures/lws.ts are synthetic, shaped exactly after the cited sparq lines; the
  1,500-member listing overrides sparq's default page_size=100 to 500 for three pages.

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
  names (exact Turtle `PN_PREFIX`), so crafted terms can never forge triples. Prefixes are only
  cosmetic: a dotted prefix name, one that some IRI starts with (`name:`), or a namespace containing
  `[` (IPv6 hosts) is silently dropped.
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
- Solid moves are copy+delete emulation (new URL, capped at 2 000 resources). LWS moves need
  MoveResource (`unsupported` with `feature: 'move'` otherwise), and the server picks the name.
- LWS `setMetadata` refuses the server-managed rels `linkset`, `type` and `up`. Solid rels that are
  not IRIs map to `http://www.iana.org/assignments/relation/<rel>`.
- `readRdf` with a matching `ifNoneMatch` resolves with `notModified: true` and an empty dataset
  (an extension to ADR-003's `RdfReadResult`). `writeRdf` serialises the n3-writable formats.
  JSON-LD serialisation is `unsupported` (`feature: 'rdfConneg'`) until an allowed dependency
  provides a JSON-LD writer: a documented deviation from ADR-003 §1, tracked in the suite tracker.

RDF/JS types (`DatasetCore`, `Quad`, `Term`) come from `@jeswr/fetch-rdf`'s type re-exports, so the
emitted declarations need no `@rdfjs/types` dependency (which the layer guard does not allow).

Before implementation, read SDK core ADR-001 D4 and `ADR-003-storage-client.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

This package is security critical. Keep coverage thresholds at 100% and add behavioral and adversarial tests with the implementation.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.
