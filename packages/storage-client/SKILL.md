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
T-021 adds the Solid backend's read side; T-022 adds its mutations. `./solid` exports
`createSolidBackend({ fetch, root, features?, etagFollowUp? })` and the pure async
`buildN3Patch({ inserts, deletes, where? })`. `./lws` and `./testing` remain reserved (T-023…T-025).

Solid read side (ADR-003 §6):
- Every URL must be absolute and pass guarded-fetch `assertWithinPodScope(root, url)`; otherwise
  `scope`, before any request. The canonical URL is the one fetched. Redirects are never followed
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
  `parseWacAllow`).

Solid write side (ADR-003 §6, T-022; implementation isolated in `src/solid-write.ts`):
- Every target, container, destination, Location and describedby URL passes `scoped(root, method,
  url)` before a request (absolute URLs, credentials redacted on scope errors). Every mutation
  target refuses queries/fragments, including empty `?`/`#`. Requests use `redirect: 'manual'`;
  unexpected 2xx/3xx are `invalid-response` and unread bodies are discarded. Only 200/201/204/205
  succeed. Errors use `failed`/`storageErrorFrom` (412 includes the response ETag, 409 is conflict,
  405 method-not-allowed, 415 unsupported-media-type, 422 bad-request).
- Transport failures are retryable `network`; aborts and all failures with a ReadableStream
  request body (including HTTP errors) are non-retryable, retaining code/status/retry delay.
  Streams pass through with `duplex: 'half'`;
  strings/Uint8Array/Blob pass directly. Abort signals are checked before/between requests.
- `write`/`writeRdf` require a nonempty string `ifMatch`; `'*'` means no Solid precondition/header.
  `patch`/`delete`/`move`/`setMetadata` require a non-'*' ETag string (TypeError before requests).
  Header values (contentType, ifMatch, Slug, patch media type) reject leading/trailing whitespace,
  CR/LF/NUL and non-ByteString with TypeError; check whitespace before comparing ifMatch to '*'.
  Content types must be valid media types (parameters allowed). `write` and resource `create`
  require contentType. Wrong option types are TypeErrors.
- PUT/PATCH/POST results use `created: status === 201`. ETag comes from the response, else a scoped
  `client.head` when `etagFollowUp` (default true). Any follow-up HEAD failure, including abort or
  redirect, yields null: the mutation already committed. `etagFollowUp: false` disables the HEAD.
- `write` PUTs Content-Type and If-Match (except '*'); a container path is method-not-allowed.
  `writeRdf` uses `serializeQuads`, default text/turtle, only WRITABLE_RDF formats. JSON-LD writing
  remains unsupported (`feature: 'rdfConneg'`, documented deviation sst-3n68).
- `create` requires a trailing-slash container; kind defaults to resource. Names must be strings,
  nonempty, neither '.' nor '..', with no slash/control characters; encode with encodeURIComponent.
  Named creates PUT the exact child (+ '/' for containers), `If-None-Match: *`; a 412 becomes
  conflict ('name taken') preserving status 412. The internal exact-URL helper accepts an already
  encoded last segment, so move never decodes a stored name (which need not be UTF-8).
- Unnamed creates POST with a crypto.getRandomValues random 16-character lowercase RFC 4648
  base32 Slug. Containers send BasicContainer Link type and empty text/turtle body; POST resources
  send Resource Link type, and null means empty body. Location is required, resolved against the
  parent, scoped, query/fragment-free, a direct child, and trailing-slash iff container. Invalid
  Location is invalid-response; its URL is never fetched or retained in the error, including its
  cause chain. The error names only the scoped container. `opts.links` is ignored: Solid types
  belong in RDF; metadata is never written implicitly (ADR's writable-describedby qualification).
- RDF patches use `buildN3Patch`'s fixed InsertDeletePatch envelope; formula order is nonempty
  where, deletes, inserts. Every triple line is serialized through rdf-serialize/n3.Writer in
  N-Triples style; the final semicolon is followed by `.\n`. Serialization reuses rdf.ts IRI
  escaping and language checks. Subjects must be NamedNode/BlankNode/Variable, predicates
  NamedNode/Variable and objects NamedNode/BlankNode/Literal/Variable. Reject non-default graphs
  and blank nodes in all N3 formulas (where/deletes/inserts).
  Solid Protocol §5.3.1 forbids blank nodes in insertions and deletions; this corrects ADR-003 §6's
  "blank nodes in inserts are allowed by CSS" remark. CSS enforces the prohibition. Variables
  must match SPARQL VARNAME minus the leading digit (start with a letter or underscore, as n3/CSS
  require) and occur in where before use in inserts/deletes. Invalid RDF is bad-request, status
  null, before any request; empty inserts+deletes is TypeError ('empty patch').
- Format choice deliberately differs from ADR §6: prefer text/n3 when advertised for text/turtle,
  or patch state is not available (undescribed default). Use application/sparql-update only when
  N3 is absent, SPARQL advertised, and there is no nonempty where/variable; emit nonempty DELETE
  DATA then INSERT DATA joined by `;\n`. Select the format before the single validation pass:
  SPARQL INSERT DATA allows insert blank nodes; where/deletes still refuse them. SPARQL retains
  deterministic collision-free blank-node relabeling (reserving `_:patch`) for stable bytes.
  Directional literals are bad-request (status null) before HTTP with SPARQL 1.1 Update, which
  cannot express their base direction. N3 Patch retains them: installed CSS 8.0.0-alpha.3 uses
  n3 2.1.1, whose N3PatchBodyParser accepts `"example"@en--ltr` with its complete term intact.
  Otherwise unsupported (`feature: 'patch'`). N3 requires every deletion to match (409),
  preserving memory conflict semantics; SPARQL DELETE DATA silently
  ignores absent triples. JSON patch requires application/json-patch+json in any advertised format
  entry; ops must be an array of objects with a valid op/string path (TypeError otherwise), sent
  with JSON.stringify. Raw patch sends validated mediaType/body. Every PATCH sends If-Match.
- `delete` refuses the root (method-not-allowed). Nonrecursive DELETE sends If-Match; recursive
  resource deletion is the same. Recursive container deletion HEAD-checks the top ETag byte-equal
  first (mismatch: 412/current ETag), walks scoped listAll, and deletes children before containers.
  Children and the final container DELETE are unconditional: child ETags are unknown and container
  membership changes its ETag. Concurrent additions can make the final DELETE conflict (409).
- Solid move is emulated (features.move.detail.native false): refuse the root, require a container
  destination, reject self/subtree container cycles with conflict before requests, comparing
  percent-decoded path segments (raw segment on decoding failure; decoded slashes remain inside
  their segment). Requests retain raw path spellings. Validate/encode an explicit name
  or retain the raw source segment. Read/head the source and compare its ETag before any writes.
  Resources stream their GET body/Content-Type into PUT with If-None-Match:* then DELETE source
  with If-Match matching that GET's ETag. Source validators must be single strong entity-tags;
  missing/unusable GET ETags or missing/malformed Content-Type
  are invalid-response errors identifying the source GET, before its destination PUT.
- Container moves walk listAll recursively before writes, capped at 2000 resources including the
  top container (unsupported/feature move above the cap). Preflight HEADs every member to discover
  auxiliary exclusions and rejects missing/unusable validators for copied resources before writes;
  any supplied auxiliary-resource validator used for teardown must also be strong. No resource GET
  bodies are read during preflight. Copy breadth-first, creating containers before children and
  streaming one resource at a time without buffering. Record each GET ETag for depth-first source
  deletion: copied resources use that validator, auxiliary members use their HEAD ETag when present,
  containers remain unconditional because membership changes their ETag. Listed .acl/.acr,
  advertised describedby documents, and every scoped rel="acl" link target (WAC or ACP,
  regardless of filename) discovered during header preflight are excluded from implicit copies;
  source teardown still deletes listed auxiliary members. The explicit move source is never
  excluded. ACLs and metadata are not copied implicitly.
- Copy failure rolls back completed copies deepest-first and rethrows the original error. Resource
  cleanup trusts only its own PUT-response ETag when it is exactly one strong entity-tag (no
  wildcard, weak tag, list or malformed value); follow-up HEAD observations are kept separately
  for successful results. Copies without a usable create-response ETag and their ancestors are preserved,
  reporting a partial move (conflict with the original cause). Validated containers are removed
  unconditionally after children. Any source DELETE failure (including 4xx/5xx) throws conflict,
  cause = delete error. Retain acknowledged deleted sources' copies; before removing any other
  copy, HEAD its source without the caller's signal. Remove it only if HEAD succeeds; any HEAD
  failure (404, 5xx, network, scope, etc.) preserves the copy and its ancestor containers.
  Report a rolled-back move only when all copies were removed and no source deletion succeeded;
  otherwise report a partial move, including rollback failures. Cleanup ignores the spent caller
  signal, continues after failures, and reports original+rollback failures via AggregateError
  cause without masking them.
  Successful move returns target/created true and top create ETag; containers refresh it by HEAD
  when enabled (failure null).
- `setMetadata` reads metadata(url), scopes the describedby target, checks the metadata ETag (412
  with current ETag before PATCH), then computes deduplicated effective RDF changes. Anchor
  defaults to the resource and must be scoped; href must be an absolute IRI. Absolute IRI rels
  stay unchanged; registered `^[a-z][a-z0-9.-]*$` tokens (case-insensitive) lower-case into
  http://www.iana.org/assignments/relation/<rel>; invalid rel/href is TypeError. Add only absent,
  remove only present triples; cancelling changes are no-op and return the current ETag. Otherwise
  PATCH describedby with N3 and its If-Match; 405 naturally maps to method-not-allowed. Return its
  response ETag or follow-up HEAD of the metadata URL or null. No describedby remains unsupported.

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
