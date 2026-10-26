---
name: storage-capabilities
description: Work on @jeswr/storage-capabilities, the storage description discovery and feature flags package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/storage-capabilities

T-010 implements the ADR-002 vocabulary and type contracts, plus internal Link/probe-header parsers.
T-011 adds `parseLwsDescription(json, storageUrl, requestUrl)` and `CapabilitiesError` at the root.
T-012 adds the internal Solid description dataset mapper in `src/solid-description.ts`.
T-013 implements `resolveStorageDescription` and `probe` at the root and both cache factories.
The root entry point also exports types; `./vocab` exports vocabulary objects (`LWS.Storage`,
`SOLID.storageDescription`, and the other ADR-002 IRIs). `./testing` exports the representative
`sparqLwsCid` example; `./cache` exports `createMemoryCache`, `createIndexedDbCache` and its options type.

Before implementation, read SDK core ADR-001 D4 and `ADR-002-capabilities.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

The CID parser consumes decoded compact JSON by shape, independent of Content-Type, without
remote context processing. It checks URL-normalised id equality, Storage typing, exactly one
StorageRoot, and same scheme/authority for the description/root and request. It preserves unknown
types/extras and expands bare LWS type/subscriptionType terms; verification method crypto types
stay verbatim. Only JWK-backed verification methods enter the public contract. The resolver must
apply response cache metadata, injected clocks, and the response-size limit; parser defaults are
`Date.now()`, null ETag, and one-hour TTL. Do not introduce fetching into the parser.

Reuse `src/link.ts` for Link parsing. Its output retains the resolved `context` from `anchor`;
callers must check that context before treating a link as metadata about the response resource.
`parseLinkHeaders(values, responseUrl, options?)` retains the legacy defaults: ignore field values
over 8,192 UTF-8 bytes and silently stop at 64 nonempty members across fields (malformed members
count). The optional `maxBytes` / `maxMembers` limits are non-negative safe integers. For authoritative
links, set `onOverflow: 'throw'`: exceeding either limit throws the root-exported
`LinkHeaderOverflowError` (`limit`: `maxBytes` or `maxMembers`) instead of returning partial results;
exact limits are accepted. `onOverflow: 'truncate'` is the default. The parser never fetches.
`src/probe-headers.ts` converts supplied response headers into `ProbeResult` without fetching.
Pass ordered raw header pairs when response evidence order matters; a `Headers` instance may
already have sorted/combined the fields. Network probing belongs to the resolver task.

`parseSolidDescription(dataset, rootUrl)` implements ADR-002 step 5c and returns only
`{ services, capabilities }`. Parse RDF bytes with `@jeswr/fetch-rdf`'s `parseRdf` first,
using the description URL as `baseIRI`; remote JSON-LD contexts need an explicit loader.
The tests supply the notifications context offline. The mapper finds `notify:subscription`
on any subject, but reads `did:service`, `lws:capability`, and ACQ endpoints only on `rootUrl`.
HTTP metadata and origin validation remain the resolver's responsibility.
The resolver passes the internal third argument `notificationsOnly: true` for foreign Solid
descriptions so generic root services/capabilities cannot masquerade as notifications.

Resolver changes must retain the HEAD/seed-header discovery order, LWS priority, bounded Solid
ancestor walk, NSS fallback, and same-origin LWS validation before GET. Fresh prefix hits make
zero requests; expired descriptions make a direct conditional GET. A 304 preserves parsed data
and a cached probe; replacement bodies discard the probe. 404/410 and root mismatch invalidate
records. The optional `StorageDescription.evidence` array records the ADR's assumed-origin-root
and cross-origin-description evidence without changing the DescriptionSource union.

All fetches use the injected transport, manual redirects and optional abort signal. Count body
bytes while streaming and cap at 1 MiB regardless of Content-Length. The standard W3C notifications
context is bundled (with the legacy notification/v1 alias); refuse all other remote contexts.
Foreign Solid descriptions are notification-only and fetched with credentials omitted; guarded
fetch remains responsible for SSRF and credential destination policy. Do not add a private-IP guard.

`probe(root, fetch, { signal?, now? })` tries OPTIONS, then HEAD on a transport/HTTP failure, and
records one response through `parseProbeHeaders`. Never invoke it automatically for LWS.

Cache factories store the public description and optional probe. Prefix lookup matches the longest
normalised root with origin/path boundaries; get/set copy metadata. Deleting a record invalidates
it even though its prefix mapping can remain until rediscovery. A storage has one root:
`rememberPrefix` drops that storage's other prefixes, and the resolver ignores (and, after a
refresh, rediscovers past) a record whose root no longer contains the requested URL. IndexedDB uses raw browser APIs,
lazy opening, transaction completion before resolving writes, and closes each connection after
its transaction. fake-indexeddb is a policy-approved development dependency for the shared contract
and persistence/error tests. Keep the package's configured 100% coverage thresholds unchanged.

Only the five recognised `notify:` channel classes become notification service types; any other
`notify:channelType` value stays in `extra` so it cannot pose as another service class.
Extras use expanded predicate keys. IRIs and literal lexical values are strings; singleton
values are scalars and repeated values are arrays. Notification features are always arrays.
Nested blank nodes become property objects with an `@id` matching later references;
callers can find a shared node's mapped properties by matching that identifier.
Repeated/cyclic references and nesting beyond 32 nodes become `{ "@id": "_:<label>" }`
references. Named service/capability nodes retain
their IRI as `id`; blank-node entries omit `id`. Unknown types survive the mapping.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.

## Feature vocabulary (T-014, for app authors)

Call `capabilities(url, { fetch })` and branch on `state` (`available` | `unavailable` | `unknown`).
Treat `unknown` as "do not offer the feature yet", not as an error. `evidence` names what decided
the state: `<source>:<TypeLocalName>[:<endpoint>]`, `<source>:absent:<TypeLocalName>`, `header:<Name>`,
`emulated`, `default:n3-patch` or `none`. Use it in logs and share-dialog copy, never for logic.

| Feature | Meaning for an app |
|---|---|
| `liveUpdates` | `detail.channels` in preference order `websocket`, `sse`, `webhook` (LWS only, needs the SDK relay), `legacy-ws` (NSS `Updates-Via`). Solid webhook/LDN-only storages are `unavailable`. |
| `realtimeCollab` | A `ssd:CrdtSyncService` conforming to `ssd:y-protocol-v1`. `detail.endpoint` is the ticket endpoint. |
| `serverSearch` | ACQ / `ssd:SparqlQueryService` endpoint. |
| `typeIndex` | `mode: 'server'` (LWS, both TypeIndex and TypeSearch services) or `'client'` (Solid profile type indexes). |
| `accessRequests` / `accessGrants` | LWS services or the `ssd:` Solid equivalents. `profiles` must include `lws:AccessProfile` before pod-access uses them. |
| `accessControl` | `odrl-grants` / `none` on LWS. On Solid: the `ssd:AccessControl` capability, else the probe (ACP link beats acl link beats WAC-Allow). |
| `versioning` / `trash` | `ssd:VersioningService` / `ssd:TrashService` endpoints. |
| `move` | LWS `MoveResource` (`native: true`, `containers`, `preservesIdentifier`). On Solid it is always available as copy+delete emulation that changes the URL. |
| `patch` | `formats` maps a resource media type to patch media types. LWS always includes JSON Patch for `application/json` and linksets. Solid uses the `ssd:PatchSupport` capability, else Accept-Patch, else N3 Patch. |
| `resumableUploads` / `recursiveDelete` | Capability local names `ResumableUploads` / `RecursiveDelete`. |
| `pagination` | Always on LWS, never on Solid. |
| `rdfConneg` | Always on Solid (Turtle, JSON-LD). On LWS only with a `ContentNegotiation` capability whose source is RDF. |

Trust: only notification entries are read from a cross-origin Solid description. `legacy-ws` comes
only from the resolver's own `Updates-Via` mapping. An unrecognised `notify:channelType` never
becomes a service type. Unknown types are ignored, and `deriveFeatures` never throws (fast-check
property test). Without a description document (NSS), rows that depend on the description are
`unknown`, not `unavailable`.
Feature-bearing keys are matched exactly (`name`, `ssd:name`, or the full `ssd:`/`lws:` IRI); an
unrelated predicate with the same local name is ignored. `AccessControl` models and `PatchSupport`
formats are unioned across all matching capabilities. Every described service endpoint except
Solid notification services must share the storage root's origin (ADR-008 §8).

`capabilities()` attaches its probe through the optional `DescriptionCache.attachProbe`, which
writes only when the record still holds the same description and no probe (both shipped caches
implement it atomically). Custom caches without it never store the probe, so it is repeated on
the next call rather than written non-atomically. PatchSupport parsing is linear in its input and
resolves the mapper's `{ "@id" }` references to a format node expanded elsewhere; each format node
is read once however often it is referenced. The Solid mapper expands named `ssd:format` nodes
(other named objects stay IRI strings). An `application/rdf+xml` ContentNegotiation source counts
as RDF.

