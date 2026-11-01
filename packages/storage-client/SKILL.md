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
  reports a non-RDF or unparsable body as `not-rdf`. `metadata` reads the `describedby` document as
  RDF (`unsupported` when none is advertised).
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

## LWS read side

- `root` is a scoped HTTP(S) StorageRoot container URL ending `/`, without query/fragment
  (including empty delimiters); malformed container roots throw TypeError, unsafe roots `scope`,
  like Solid. `storage` is StorageDescription.id; default `root`: sparq's `LwsConfig::storage()`
  returns the root and its lws#storage link names that URL (`src/lws/mod.rs:421-425`,
  `src/lws/resources.rs:684-704`). Normalise `storage` once with `new URL(storage).href`; non-absolute
  or non-HTTP(S) ids throw TypeError. Link comparisons use that normalised id, so equivalent URL
  spellings match. `features` defaults to `deriveFeatures` for an undescribed LWS
  storage (empty services/capabilities, probe source), or retains the supplied Features object.
- Design call: `isWithinStorage` calls `scoped(root, …)` synchronously on both backends, returning
  true only when it succeeds. It applies the same standalone-destination and resolution-equivalence
  checks as requests, including rejection of ambiguous same-scheme references.
  Every request must pass `scoped(root, …)` before fetch; storage-id equality never authorises an
  authenticated request outside the root, narrowing ADR-003's non-path-aligned identifier rule.
  On every response (HEAD, read, readRdf, list, metadata), ANY lws#storage link in the response URL's
  context that differs from `storage` gives `scope` and discards the body. Matching/absent links
  are accepted; links with a different anchor context are ignored. Errors never echo the foreign id.
- `list` and `listAll` accept scoped opaque container identifiers, including those without a trailing
  slash, preserving their URLs. Query/fragment (even empty `?`/`#`) gives `bad-request`, except a
  query matching the advertised version-history template for a scoped resource. Fragments remain
  refused. The response must be a valid Container or ContainerPage. GET Accept:
  `application/lws+json, application/ld+json;q=0.5`. Cursors are scoped first, then fetched as canonical
  URLs with opaque queries preserved. Only 200 succeeds; other 2xx/3xx are
  `invalid-response`, HTTP errors use the shared mapping, redirects are never followed.
- Listing media type must be lws+json or ld+json. JSON is capped at **16 MiB of streamed bytes**
  for listings and linksets, independently of Content-Length; overflow/bad JSON → `invalid-response`.
  Top level must be an object, type (string/array) includes Container or ContainerPage (compact or
  full https://www.w3.org/ns/lws# IRI), and items must be an array. sparq's ordinary pages all use
  Container; type-search pages use ContainerPage (`src/lws/index.rs:625-675`). Each item must be an
  object with string id; malformed structure → `invalid-response`. Resolve ids against response
  URL; drop invalid, non-HTTP(S), unsafe or foreign ids; duplicate resolved ids keep the first.
  Each page accepts at most **10,000 raw items** and **4 MiB of cumulative resolved id lengths**,
  measured in UTF-16 code units before retaining entries. Every successfully resolved id occurrence
  counts, including duplicates and ids later dropped by scope checks. Exceeding either budget gives
  `invalid-response`; exact limits are accepted. These budgets apply independently of the streamed
  JSON byte cap and prevent short ids from amplifying a long cursor URL.
- Entry order follows the server. Kind depends only on Container type, never a trailing slash.
  Content type is valid RFC 6838 `format` (shared MEDIA_TYPE with Solid), null for containers;
  size is a non-negative safe integer; modified is a parseable date string; else null. Types retain
  only absolute IRIs, excluding compact/full Container and DataResource; malformed optional fields
  drop only that field. `total` is non-negative safe-integer totalItems or null; etag is verbatim.
  `next` uses the first response-context next Link, resolved against that URL; foreign/unsafe or
  self links → `invalid-response`. Compare next links with the current page after scoping and
  canonicalisation (including the slashless root alias), and return canonical cursor URLs with
  opaque queries preserved. A canonical `next` cursor exceeding **8,192 UTF-16 code units** gives
  `invalid-response`; the exact limit is accepted. This also stops page-by-page cursor growth before
  short Link targets can amplify an oversized response URL. `listAll` uses shared paginate: loop guard,
  10,000 pages maximum, abort between entries. No client sorting or cursor reconstruction.
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
  merge in order. Normalisation accepts at most **10,000 targets** across all contexts and relations
  and **4 MiB of cumulative resolved anchor + href URL lengths**, measured in UTF-16 code units.
  Every anchor occurrence counts, including duplicates and contexts without targets, and every
  target href counts. Exceeding either budget gives `invalid-response` during expansion, before
  retaining further entries or allocating their params; exact limits are accepted. These limits
  apply independently of the streamed JSON byte cap and prevent short references amplifying a long
  linkset base URL. Params keep only string-valued attributes except href; array attributes including
  hreflang/title* are skipped (preserved in raw). raw is parsed JSON, url is the fetched linkset URL,
  etag is its ETag. Maps and own-property params preserve hostile property names as data.
- `parentOf` scopes first; root → null without a request, otherwise one HEAD returning parent.
  Fixtures in src/fixtures/lws.ts are synthetic, shaped exactly after the cited sparq lines; the
  1,500-member listing overrides sparq's default page_size=100 to 500 for three pages.

## LWS write side

- Every mutation target, destination, Location, Content-Location and follow-up HEAD stays scoped
  to the root, with the same canonicalisation, credential redaction, manual redirects, bounded
  Link parsing and response storage-id validation as reads. Mutation URLs reject queries and
  fragments, including empty delimiters. PUT/PATCH/DELETE accept only 200/204/205; POST requires
  201. In particular, PUT never creates: 404 remains not-found, 201 is invalid-response.
- `write`/`writeRdf` require a nonempty `ifMatch`; `'*'` sends `If-Match: *`. All other mutations
  require a non-wildcard ETag. Headers reject whitespace padding, CR/LF/NUL and non-ByteString
  values; media types must be syntactically valid. Root content cannot be PUT; other resource
  kinds are validated by the server, never inferred from an identifier's trailing slash.
  RDF serialisation uses the shared serializer; JSON-LD writing remains unsupported.
- `create` always POSTs: optional `name` is the Slug hint, never an exact child name. Emit Container
  or DataResource Link type plus each validated `opts.links` entry. Initial up/linkset metadata is
  refused. Create parents and move destinations may be slashless opaque identifiers; the server
  validates their kind. Null bodies become empty bodies; containers default to application/lws+json, resources
  require contentType. Location is mandatory, scoped and query/fragment-free, but need not follow
  the parent's URL path (LWS logical containment). It cannot name the parent or root. Untrusted
  Location and Content-Location values are never retained in errors or causes.
- Ordinary mutation results use their response ETag or a follow-up HEAD, else null if HEAD fails:
  the mutation already committed. Streaming bodies are forwarded with duplex half and never
  replayed automatically; failures, including HTTP errors, are nonretryable for streams.
- JSON patch sends application/json-patch+json plus If-Match. Raw patches validate mediaType and
  string body. RDF patch rebuilds caller quads before asynchronous reads, refuses invalid term
  positions, variables and any nonempty where clause. When any SPARQL format is advertised, HEAD
  discovers the actual resource media type: only that format's advertisement enables SPARQL
  DELETE DATA/INSERT DATA for default-graph patches, using the shared safe formula serializer.
  Patches containing named graphs always use RMW to preserve graph identity in TriG/N-Quads.
- **Otherwise RDF patch is RMW:** readRdf, check the initial ETag against the caller's ifMatch,
  applyQuadPatch in n3 Store, serialize in the original writable RDF format, then PUT with the
  read ETag. On 412 reread and reapply exactly once; the initial caller ETag check is not repeated
  against the newer state. A second 412 propagates. Missing retry ETags fail closed; absent
  deletions conflict, blank-node deletions and named graphs in triple-only formats are refused.
- `setMetadata` uses the linkset ETag (not the content ETag), checked before PATCH. Generate
  sequential JSON Patch against a cloned raw document, retaining other anchors, relations and
  attributes. Add new anchors/rel arrays when needed, append absent targets, remove all matching
  target occurrences descending within each repeated anchor context, and escape JSON Pointer
  keys. Empty/no-op changes avoid PATCH. Explicit anchors must be scoped; hrefs and extension
  rels must be absolute IRIs; registered rel tokens lower-case. type/up/linkset are always
  unsupported here, including when MoveResource is available; anchor is reserved structure.
- `move` requires features.move available, a matching source ETag, and a usable linkset ETag.
  Container moves also require detail.containers. Refuse root/self moves. Ignore name. Require
  one resource context with one up target, then send test of the raw anchor and replace of
  `/linkset/i/up/0/href`, with the linkset's If-Match. When Content-Location is present (or
  preservesIdentifier is false), require scoped Content-Location and parse the bounded returned
  linkset; require one scoped anchor with exactly one up target naming the destination and one
  linkset target naming Content-Location, independently of context order. Reject missing or
  ambiguous identity relations before the follow-up HEAD. A move with
  preservesIdentifier false requires Content-Location. HEAD the resulting resource for its ETag;
  the PATCH ETag belongs to the linkset. created is true only when the identifier changes.
- Nonrecursive delete sends If-Match and refuses the root. Recursive delete always uses client
  traversal: features.recursiveDelete advertises the POST-based RecursiveDeleteService, which
  does not establish Depth support for DELETE. HEAD-check the top ETag,
  preflight paginated listings + HEAD through logical containment (not URI prefixes), accepting
  slashless opaque container identifiers only after HEAD confirms their container kind. Require
  each child's up to match its listed parent and every child to have an ETag. Cycles, duplicates, root members,
  and trees above 10,000 nodes fail before deletion. Delete in reverse traversal order, refreshing
  container ETags after child deletion; every DELETE is conditional. Concurrent additions can
  still produce 409 and partial deletion. Errors propagate without a destructive retry.

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
  membership changes its ETag. Concurrent additions can make the final DELETE conflict (409). A descendant that answers 404 is skipped, because deleting a subject also deletes its auxiliary documents (Solid Protocol §5.4); a 404 for the top container still fails.
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
  top container (unsupported/feature move above the cap). Preflight inspects every container's RDF,
  including the top one, reusing the listing GET and its parsed dataset with the existing RDF body
  handling and limits. Only `ldp:contains` (any subject), and statements about that container or its
  listed members using `rdf:type` with an LDP-namespace IRI or `pim:Storage`, `dcterms:modified`, or
  a predicate in `http://www.w3.org/ns/posix/stat#` are allowed, plus `rdf:type`
  `<http://www.w3.org/ns/iana/media-types/{type}#Resource>` on listed members (file-backed CSS
  types every member with its media type). Anything else refuses the move with
  `unsupported`/feature `move`: container RDF would not be preserved. Other types, including an
  IANA class on the container itself, are refused. CSS 8.0.0-alpha.3 sources
  (under its installed package): `dist/storage/DataAccessorBasedStore.js:95–100` generates containment
  and includes child metadata; `dist/util/ResourceUtil.js:21–36` generates LDP types and
  `dcterms:modified`; `dist/storage/accessors/FileDataAccessor.js:297–305` generates `stat:mtime`
  and `stat:size`, and `:278–282` the member IANA media-type classes. Preflight HEADs every member
  to discover auxiliary exclusions and rejects missing/unusable validators for copied resources before writes;
  any supplied auxiliary-resource validator used for teardown must also be strong. No resource GET
  bodies are read during preflight. Copy breadth-first, creating containers before children and
  streaming one resource at a time without buffering. Record each GET ETag for depth-first source
  deletion: copied resources use that validator, auxiliary members use their HEAD ETag when present,
  containers remain unconditional because membership changes their ETag. Listed .acl/.acr,
  advertised describedby documents, and every scoped rel="acl" link target (WAC or ACP,
  regardless of filename) discovered during header preflight are excluded from implicit copies;
  source teardown still deletes listed auxiliary members; a 404 from one of them counts as deleted, because deleting its subject removes it (Solid Protocol §5.4). Any other source DELETE failure, including a 404 for a copied resource, still makes the move partial. The explicit move source is never
  excluded. Exclusion identity compares origin, percent-decoded path segments (raw segment on
  decoding failure), and the trailing slash; the suffix rule uses the decoded last segment.
  Requests keep their original spellings. ACLs and metadata are not copied implicitly.
  Residual race: triples added to a container after preflight are not detected, because source
  container DELETEs are unconditional.
- Copy failure rolls back completed copies deepest-first and rethrows the original error. Resource
  cleanup trusts only its own PUT-response ETag when it is exactly one strong entity-tag (no
  wildcard, weak tag, list or malformed value); follow-up HEAD observations are kept separately
  for successful results. Copies without a usable create-response ETag and their ancestors are preserved,
  reporting a partial move (conflict with the original cause). After handling copied children,
  container cleanup reads each destination deepest-first with one fresh listing GET, applying the
  same RDF parsing and body limits as preflight. It removes a container only when the listing is
  empty, its RDF passes the server-managed allow-list with no member subjects, and that GET has a
  usable strong ETag; DELETE sends that ETag in If-Match. Failed verification, GET or conditional
  DELETE preserves the container and its ancestors and reports a partial move. Destination
  containers are never deleted unconditionally during rollback. Every preflight failure after the
  first source GET discards its body before it can be handed to the destination PUT.
  Any source DELETE failure (including 4xx/5xx) throws conflict,
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
