---
name: storage-capabilities
description: Use when discovering Solid or LWS storage, selecting features with @jeswr/storage-capabilities, handling unknown support, or maintaining description parsing and caches.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

<!-- AUTHORED-BY GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/storage-capabilities

## Quick reference

Use `capabilities` for feature decisions and `resolveStorageDescription` for the storage id,
root and advertised entries. Inject the bounded `auth.fetch` from
[pod-auth](../pod-auth/SKILL.md); never infer protocol or permissions from a server hostname.
Use [storage-client](../storage-client/SKILL.md) when the app also needs resource operations.

```ts
import { capabilities, resolveStorageDescription } from '@jeswr/storage-capabilities';
import { createMemoryCache } from '@jeswr/storage-capabilities/cache';

export async function inspectStorage(fetch: typeof globalThis.fetch, url: string) {
  const cache = createMemoryCache();
  const options = { fetch, cache };
  const description = await resolveStorageDescription(url, options);
  const features = await capabilities(url, options);
  return {
    root: description.root,
    protocol: description.protocol,
    canSearch: features.serverSearch.state === 'available',
    searchEndpoint: features.serverSearch.detail.endpoint,
    accessModel: features.accessControl.state === 'available'
      ? features.accessControl.detail.model : null,
  };
}
```

Keep a cache per application account/session and share it across capability consumers; the
example creates an isolated one. The default is shared in-memory storage. `createIndexedDbCache`
from `/cache` persists public metadata only. On logout, discard session-owned memory caches
or delete each known storage id from a persistent cache; there is no `clear()` method.
`seedHeaders` can reuse headers from a response already obtained for the same URL.
`unknown` means insufficient evidence, including absent entries in a fetched description;
`unavailable` requires explicit negative support. Enable an optional feature only on
`state === 'available'`. `evidence` is diagnostic text, never a permission or routing key.
See [LWS app differences](../../skills/lws-vs-solid/SKILL.md) for cross-protocol decisions.


`StorageDescription.owner: string | null` is advisory owner metadata: the Solid root's
`solid:owner` IRI or the LWS CID's top-level `controller`. Only absolute HTTP(S) IRIs are
accepted; missing, malformed, non-IRI or non-HTTP(S) values yield null. Verification method
controllers do not supply the storage owner. Probe-only descriptions and assumed Solid roots
have owner null. Owner data never authorizes a fetch. Parsed caches are versioned so older
records without this field are rediscovered before reuse.

T-010 implements the ADR-002 vocabulary and type contracts, plus internal Link/probe-header parsers.
T-011 adds `parseLwsDescription(json, storageUrl, requestUrl)` and `CapabilitiesError` at the root.
T-012 adds the internal Solid description dataset mapper in `src/solid-description.ts`.
T-013 implements `resolveStorageDescription` and `probe` at the root and both cache factories.
The root entry point also exports types; `./vocab` exports vocabulary objects (`LWS.Storage`,
`SOLID.storageDescription`, and the other ADR-002 IRIs). `./testing` exports the representative
`sparqLwsCid` example; `./cache` exports `createMemoryCache`, `createIndexedDbCache` and its options type.

Before implementation, read SDK core ADR-001 D4 and `ADR-002-capabilities.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.
The merged `solid-specs/specs/service-description/` draft supersedes ADR-002 for the
description shapes, entry merging, profiles and absent-feature semantics (sst-br1.6).
Its `ssd:` namespace is `https://jeswr.org/ns/solid-sd#`.

The CID parser consumes decoded compact JSON by shape, independent of Content-Type, without
remote context processing. It checks URL-normalised id equality, Storage typing, exactly one
StorageRoot, and same scheme/authority for the description/root and request. It preserves unknown
types/extras and expands bare LWS type/subscriptionType terms plus the draft's fixed SSD terms;
scoped compact `channelType` and `model` values expand through the draft context.
Verification method crypto types
stay verbatim. Only JWK-backed verification methods enter the public contract. The resolver must
apply response cache metadata, injected clocks, and the response-size limit; parser defaults are
`Date.now()`, null ETag, and one-hour TTL. Do not introduce fetching into the parser.

Reuse `src/link.ts` for Link parsing. Its output retains the resolved `context` from `anchor`;
callers must check that context before treating a link as metadata about the response resource.
`parseLinkHeaders(values, responseUrl, options?)` retains the legacy defaults: ignore field values
over 8,192 UTF-8 bytes and silently stop at 64 nonempty members across fields (malformed members
count). The optional `maxBytes` / `maxMembers` limits are non-negative safe integers.
`maxResolvedBytes` optionally caps cumulative resolved target + anchor context URL lengths in
UTF-16 code units (a non-negative safe integer; default unlimited). Every retained member counts
both URLs, including duplicates and the response URL used when no anchor is supplied. The budget
is checked before retaining each member; truncation stops at the first overflowing member.
For authoritative links, set `onOverflow: 'throw'`: exceeding any limit throws the root-exported
`LinkHeaderOverflowError` (`limit`: `maxBytes`, `maxMembers` or `maxResolvedBytes`) instead of returning
partial results; exact limits are accepted. `onOverflow: 'truncate'` is the default. The parser never fetches.
For mutation guards also set `onMalformed: 'throw'`: malformed members, missing relations,
invalid URLs, duplicate parameters, empty targets and target whitespace/backslashes throw
`SyntaxError`. The default `onMalformed: 'skip'` preserves tolerant parsing and first-singleton
handling. Both throwing options are needed for complete, unambiguous inspection. Check resolved
`context` against the canonical response URL; an anchor naming that same URL is acceptable.

Reuse the root-exported `encodesPlainCharacter`, `isAmbiguousResourceTarget` and
`isAuxiliaryResourceTarget` from `src/auxiliary.ts` before URL normalisation. The first detects
encoded unreserved characters, `/`, `\` and `%`. The ambiguity guard adds raw `;`, `?`, `#`, `\`,
encoded delimiters and segment-ending dots/spaces (including `%20`). The auxiliary guard also
rejects case-insensitive `.acl`/`.acr`/`.meta` suffixes with trailing slashes. Interior escaped
spaces and UTF-8 characters remain valid. Reuse these guards in seed and generic mutation paths;
ACL-specific capabilities may use the ambiguity guard while validating advertised ACLs separately.
On servers without suffix ACL naming, an arbitrary ACL path is caught only when the resource or
its parent advertises it; lexical checks cannot discover an unadvertised association.
The package is `securityCritical`: these guards and `parseLinkHeaders` sit on other packages'
mutation boundaries, so keep 100% coverage, add adversarial tests and never auto-merge changes.
Regenerate the public declaration report using the command in README.md after changing exports.

`src/probe-headers.ts` converts supplied response headers into `ProbeResult` without fetching.
Pass ordered raw header pairs when response evidence order matters; a `Headers` instance may
already have sorted/combined the fields. Network probing belongs to the resolver task.

`parseSolidDescription(dataset, rootUrl)` implements ADR-002 step 5c and returns only
`{ services, capabilities, owner }`. Parse RDF bytes with `@jeswr/fetch-rdf`'s `parseRdf` first,
using the description URL as `baseIRI`; remote JSON-LD contexts need an explicit loader.
The tests supply the notifications context offline. The mapper finds `notify:subscription`
on any subject, but reads `did:service`, `lws:capability`, and ACQ endpoints only on `rootUrl`.
HTTP metadata and origin validation remain the resolver's responsibility.
Listed `ssd:SolidNotificationService` entries use `notify:channelType`; merge them with
`notify:subscription` entries by endpoint AND channel, unioning features (SSD-CLI-6).
Root ACQ endpoints imply `ACQ.profile` and merge with listed query services at that endpoint
(SSD-CLI-7). Flat `ssd:PatchSupport` entries use exactly one `ssd:source` and one or more
`ssd:patchType` values, one capability per source. Preserve raw extras and union derived formats.
Read-only sparq fallbacks: `ssd:channelType` (sparq-org/sparq#7234), nested `ssd:format`,
CID `format` maps and `mediaType` entries. Normative fields win; malformed flat entries cannot
fall back. The channel fallback applies only when `notify:channelType` is absent, not when
its values are literals or blank nodes. Invalid normative presence is represented by an empty
channel array, preventing downstream fallback. Validate exactly one raw channel object before
filtering by term kind; multiple IRIs or an IRI plus a literal are malformed too. Missing channels
also block downstream type-based fallback. `ssd:RecursiveDeleteService` is a service endpoint for POST `{container}`;
deprecated `ssd:RecursiveDelete` capability data leaves the feature unknown.
The resolver passes the internal third argument `notificationsOnly: true` when evidence
includes `assumed-origin-root`, suppressing root `did:service`, `lws:capability`, and ACQ
entries while retaining `notify:subscription` entries (SSD-CLI-16).

Resolver changes must retain the HEAD/seed-header discovery order, LWS priority, bounded Solid
ancestor walk, NSS fallback, and same-origin description validation for both protocols before GET
(SSD-CLI-18). Reject and invalidate cached foreign descriptions before reuse or refresh.
Fresh prefix hits make
zero requests; expired descriptions make a direct conditional GET. A 304 preserves parsed data
and a cached probe; replacement bodies discard the probe. 404/410 and root mismatch invalidate
records. The optional `StorageDescription.evidence` array records `assumed-origin-root` without
changing the DescriptionSource union. Feature derivation also distrusts root entries carrying
that evidence or the old `cross-origin-description` evidence.
Parsed cache records carry a resolver version. A missing or different version invalidates the
record and repeats discovery and an unconditional description GET; never reuse its ETag or probe.
Cache implementations must preserve the version when attaching probes.
Assumed roots never establish prefix mappings. Their `assumed-origin-root` evidence stays in the
cached description; reject existing prefix hits carrying that evidence, even at the current version,
and rediscover so one storage's notifications cannot contaminate a sibling storage on the same origin.

All fetches use the injected transport, manual redirects and optional abort signal. Count body
bytes while streaming and cap at 1 MiB regardless of Content-Length. The standard W3C notifications
context is bundled (with the legacy notification/v1 alias), as are the draft's trusted CID, LWS,
and SSD snapshots in `src/contexts/` with source headers. Accept only these exact context URLs,
clone the bundled data for each load, and never fetch contexts at run time (SSD-CLI-15).
Guarded fetch remains responsible for SSRF and credential destination policy. Do not add a private-IP guard.

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
Extras use expanded predicate keys. Known IRI-valued feature evidence (capability profiles,
models, LWS subscription types and move targets, including accepted aliases) filters out non-IRI
terms before lexical mapping. Other IRIs and literal lexical values are strings; singleton
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
| `serverSearch` | `ssd:SparqlQueryService` endpoint with the ACQ profile; the root ACQ predicate implies it. |
| `typeIndex` | `mode: 'server'` (LWS, both TypeIndex and TypeSearch services) or `'client'` (Solid profile type indexes). |
| `accessRequests` / `accessGrants` | LWS services on either protocol (legacy `ssd:` aliases still read). At least one listed profile must be `lws:AccessProfile`. |
| `accessControl` | `odrl-grants` / `none` on LWS. On Solid: the `ssd:AccessControl` capability, else the probe (ACP link beats acl link beats WAC-Allow). |
| `versioning` / `trash` | `ssd:VersioningService` / `ssd:TrashService` endpoints. |
| `move` | LWS `MoveResource` (`native: true`, `containers`, `preservesIdentifier`). On Solid it is always available as copy+delete emulation that changes the URL. |
| `patch` | `formats` maps a resource media type to patch media types. LWS always includes JSON Patch for `application/json` and linksets. Solid uses the `ssd:PatchSupport` capability, else Accept-Patch, else N3 Patch. |
| `resumableUploads` / `recursiveDelete` | `ssd:ResumableUploads` with the tus upload profile / `ssd:RecursiveDeleteService` endpoint. |
| `pagination` | Always on LWS; on Solid, available with `ssd:Pagination`, otherwise unknown. |
| `rdfConneg` | Always on Solid (Turtle, JSON-LD). On LWS only with a valid `ContentNegotiation` capability whose source is RDF. |

Trust: foreign descriptions are rejected before retrieval. With an assumed Solid root, only
`notify:subscription` entries are read. `legacy-ws` comes
only from the resolver's own `Updates-Via` mapping. An unrecognised `notify:channelType` never
becomes a service type. Unknown types are ignored, and `deriveFeatures` never throws (fast-check
property test). Without a description document (NSS), rows that depend on the description are
`unknown`, not `unavailable`.
The public signatures and `FeatureState` union are unchanged. A missing entry is `unknown`
even in a fetched description (SSD-CLI-10), including missing live notifications, sync, query,
access requests/grants, versions, trash, resumable uploads, recursive delete, LWS move/type
index/access control/RDF negotiation and Solid pagination. Protocol guarantees and existing
client fallbacks remain: Solid client type indexes, emulated move, RDF negotiation; LWS JSON
Patch and pagination. `unavailable` is reserved here for a listed notification service whose
channels the client cannot consume. Services requiring a profile need any one implemented
profile (SSD-CLI-5/20): ACQ, `ssd:y-protocol-v1`, or `lws:AccessProfile`, respectively. Missing
or unsupported profiles leave the feature unknown. Resumable uploads require
`https://tus.io/protocols/resumable-upload`. Unknown type IRIs are ignored even when their
local name matches a recognised type. Draft examples with source headers are in
`src/fixtures/{css.ttl,sparq-solid.ttl,sparq-lws.jsonld}`; keep the existing server fixtures too.

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
as RDF. ContentNegotiation requires exactly one source and at least one target, all parameter-free
media types (SSD-CAP-CONNEG-1 / SSD-DM-12). Read raw values before checking cardinality/types;
discard the entire malformed declaration so neither invalid sources nor targets enter formats.

