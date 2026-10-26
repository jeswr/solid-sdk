<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# @jeswr/storage-capabilities

> **Experimental — AI-agent-generated.** Storage discovery, description parsing, caches, and network probing are implemented.

Storage description discovery and feature flags. Design of record: SDK core `ADR-002-capabilities.md` and ADR-001 D4 in
`solid-suite-planning/specs/sdk-core/`.

Private at version 0.1.0 pending the first gate-green conformance run (ADR-001 D5).
Requires Node.js >=24 and the root pnpm workspace tooling.

The package root exports the ADR-002 type contracts, including `StorageDescription`, `Features`,
`ResolveOptions`, `DescriptionCache`, `ProbeResult`, `ProbeEvidence`, and `WacMode`.
It also exports the header parsers `parseLinkHeaders(values, responseUrl, options?)` (RFC 8288) and
`parseWacAllow(value)` so that `@jeswr/storage-client` reuses them instead of copying them.
`@jeswr/storage-capabilities/vocab` exports `LWS`, `DID`, `SEC`, `DCT`, `NOTIFY`, `SOLID`,
`PIM`, `ACQ`, `ACL`, `ACP`, and `SSD` objects with full IRI values (for example, `LWS.Storage`).
The package's TypeScript configuration includes DOM types for the ADR's Web Crypto `JsonWebKey` contract.

`parseLwsDescription(json, storageUrl, requestUrl)` accepts an already decoded compact CID object,
including bodies served as `application/lws+cid`, `application/cid`, or `application/ld+json`.
It validates the normalised storage id, the Storage type, and exactly one StorageRoot. Both the
description URL and root must share the request URL's scheme and authority (ADR-002 §Security).
It maps services, capabilities, and JWK-backed verification methods, expands bare LWS
type/subscriptionType terms, and preserves unknown types and raw extra keys. Verification method
types and key material retain their cryptographic vocabulary. Scalar subscriptionType values stay
scalar; list values stay lists. Malformed descriptions throw `CapabilitiesError` with
`code: 'description-invalid'`; foreign description/root authorities throw `code: 'root-mismatch'`.
Verification methods retain optional CID `revoked` and `expires` timestamps after validating the
calendar date, time, and timezone offset (up to ±14:00). Consumers must enforce these limits when
using a key, including from cached descriptions. JWK parsing checks known member
types and requires the public key parameters for EC, RSA, and OKP keys. Symmetric keys and all
registered JOSE private or secret key members are rejected, as are unsupported key types.
Cryptographic key import and signature verification remain the consumer's responsibility.
Errors carry the supplied storage URL. URL normalisation keeps path case and trailing slashes.

The parser sets `fetchedAt` to `Date.now()`, `etag` to `null`, and `maxAgeMs` to 3,600,000. The
resolver supplies HTTP cache metadata, injected clocks, body-size limits, and fetching. Parsing
uses the compact CID shape directly and does not fetch or expand JSON-LD contexts.
`@jeswr/storage-capabilities/testing` exports `sparqLwsCid`, a representative public example of
the sparq service set documented in ADR-002 and SDK-core STATUS.md, covered by a snapshot test.
It is not a recorded server response.

`resolveStorageDescription(url, { fetch, cache?, seedHeaders?, maxAncestorProbes?, signal?, now? })`
resolves from any resource through HEAD and its advertised Link target. LWS takes priority;
Solid root discovery walks at most eight ancestors by default. `seedHeaders` skips the initial
HEAD. NSS `Updates-Via` headers and legacy update links produce a probe-only Solid description.
The optional `evidence` array records `assumed-origin-root` and `cross-origin-description`.

```ts
import { resolveStorageDescription, probe } from '@jeswr/storage-capabilities';
import { createMemoryCache, createIndexedDbCache } from '@jeswr/storage-capabilities/cache';

const cache = createMemoryCache(); // Or createIndexedDbCache({ dbName: 'my-public-metadata' }).
const description = await resolveStorageDescription(resourceUrl, { fetch: authFetch, cache });
if (description.protocol === 'solid') {
  const observations = await probe(description.root, authFetch);
  await cache.set(description.id, { description, probe: observations });
}
```

The resolver uses a shared memory cache unless one is supplied. Both cache factories implement
`DescriptionCache`, including longest-prefix lookup with URL origin and path boundaries.
Records include the description and optional probe. Memory cache reads/writes copy records;
IndexedDB persists the same data using raw browser APIs, with no runtime adapter dependency.
The default database name is `jeswr-storage-capabilities`. IndexedDB is opened lazily and
errors reject the operation. `cache.delete(id)` invalidates the record; retained prefix mappings
cannot serve a deleted record. Callers should invalidate session metadata on logout.

Fresh descriptions resolve without fetching, including sibling URLs beneath a known root.
TTL comes from `Cache-Control: max-age`, otherwise one hour. On expiry, the resolver GETs the
known description directly with `If-None-Match` when an ETag exists. A 304 retains the description
and cached probe, bumps `fetchedAt`, and updates cache headers when supplied. A replacement body
discards an old probe. Description 404/410 and root mismatch invalidate the cached record.
Expired legacy descriptions repeat discovery because there is no description resource to GET.

Every network request uses the injected fetch, `redirect: 'manual'`, and the supplied signal.
Pass a guarded authenticated fetch for SSRF protection. LWS descriptions and roots must share
the requested resource's origin. Foreign Solid descriptions contribute only `notify:subscription`
entries and use `credentials: 'omit'`; the injected transport must also enforce its credential
destination policy. All description bodies are capped at 1 MiB of streamed bytes, even with a
missing or dishonest Content-Length. Parsing uses `parseRdf` and the description URL as base.
The standard W3C notifications context (and its legacy notification/v1 alias) is bundled for
CSS JSON-LD; other remote contexts are refused without a network request.

`probe(root, fetch, { signal?, now? })` uses OPTIONS, then HEAD if OPTIONS fails or is unsupported.
It returns parsed Accept-Patch, Accept-Post, WAC-Allow, ACL/ACP links and Allow with raw header
evidence. Denied HEAD responses can still supply observations. Run it only for Solid; LWS
descriptions are authoritative. See "Feature flags" below for `deriveFeatures` and `capabilities()`.

Internal helpers:

- `parseLinkHeaders(values, responseUrl, options?)` in `src/link.ts` accepts one combined Link field,
  an array of separate field values, or `null`. It resolves targets and anchor contexts independently,
  retains relation lists and unquoted parameters, and ignores later singleton parameters.
  Extended attributes such as `title*` retain their wire encoding. A deterministic tokenizer skips
  malformed members at unquoted commas outside targets; an unterminated quote or target consumes the
  rest of that field. By default, fields over 8 KiB (UTF-8) are ignored, and parsing stops after 64 nonempty members
  across all fields, including malformed members. Invalid target/anchor URLs and members without
  relations are ignored. Options `maxBytes` (per field) and `maxMembers` (across fields) accept
  non-negative safe integers. Set `onOverflow: 'throw'` to reject incomplete inspection with the
  exported `LinkHeaderOverflowError`, whose `limit` is `maxBytes` or `maxMembers`; exact limits
  are accepted. The default `onOverflow: 'truncate'` preserves the original behaviour.
- `parseProbeHeaders(url, headers, observedAt)` in `src/probe-headers.ts` parses ordered raw header
  pairs (or a `Headers` instance) into the architect's `ProbeResult`. Raw pairs preserve response order;
  `Headers` iteration may sort and combine fields. Recognised fields remain as evidence, including
  malformed WAC-Allow values. WAC-Allow keeps known user/public permissions alongside unknown
  groups and modes, lower-cases modes before recognition and deduplication, skips empty list
  members, merges repeated groups, and rejects malformed syntax. Accept-Patch and Accept-Post use
  a single-pass tokenizer for quoted parameters; an unterminated quote discards that member and
  the remainder of the combined field. Combined Accept-Patch, Accept-Post, and Allow fields over
  8 KiB (UTF-8, including joining commas) are treated as absent while retaining raw evidence.
  Links with a different anchor context are ignored for access control.
- `parseSolidDescription(dataset, rootUrl)` in `src/solid-description.ts` maps parsed RDF/JS
  datasets to `{ services, capabilities }` (ADR-002 step 5c). Notifications on any subject become
  `SSD.SolidNotificationService` entries, with channel IRIs included in `type` and expanded
  `notify:channelType`/`notify:feature` extras. `did:service`, `lws:capability`, and ACQ
  `solid-sparql:endpoint` are read only on the supplied root. Generic entries retain unknown
  types, named-node identifiers, profiles, and expanded extra predicates. Missing or non-IRI
  service endpoints are skipped; blank-node services with an IRI endpoint are supported.
  Extras retain IRI/literal lexical strings, use scalar singleton values and arrays for repeated
  values, and expand nested blank nodes into property objects with an `@id` so shared-node
  references can be resolved to their mapped properties. Repeated/cyclic blank nodes and
  nesting beyond 32 nodes are retained as `{ "@id": "_:<label>" }` references.
  Parse bytes first with `@jeswr/fetch-rdf`'s `parseRdf` and the description URL as `baseIRI`.
  The mapper does no fetching, origin validation, HTTP metadata handling, or dataset mutation.

Feature derivation and other server fixtures arrive in later tasks.

From the workspace root:

```sh
pnpm --filter @jeswr/storage-capabilities run lint
pnpm --filter @jeswr/storage-capabilities run build
pnpm --filter @jeswr/storage-capabilities run typecheck
pnpm --filter @jeswr/storage-capabilities run test
```

Tests cover the RFC 8288 §3.5 examples, quoted parameters, anchors, relation lists, repeated fields,
malformed input, parsing every probe observation, CID mapping/validation, a CSS-style two-subscription JSON-LD description
with an offline notifications context, the ADR-008 Turtle example (four services and three
capabilities), ACQ mapping, root scoping, and malformed or cyclic extension data.
Coverage thresholds are 100% for branches,
functions, lines, and statements.
Resolver tests use injected fetch and clocks for request counts, TTL/ETag/304 refresh,
ancestor limits, NSS discovery, HTTP/parse errors, redirect/origin refusal, and streaming
body limits. Both caches share a contract suite; IndexedDB is tested with fake-indexeddb.

## Feature flags

`deriveFeatures(description, probe?)` is pure and deterministic and implements the ADR-002 mapping
table. `capabilities(url, options)` resolves the storage, probes a Solid root (OPTIONS, then HEAD)
only when the description leaves `accessControl` or `patch` unknown, caches the probe with the
description, and returns `Features`. LWS storages are never probed. A failed probe leaves those
features `unknown` and is retried on the next call.

```ts
import { capabilities } from '@jeswr/storage-capabilities';

const features = await capabilities(resourceUrl, { fetch: authFetch });
if (features.liveUpdates.state === 'available') subscribe(features.liveUpdates.detail);
```

`@jeswr/storage-capabilities/testing` also exports four synthetic server fixtures (`cssStorage`,
`sparqLwsStorage`, `essStorage`, `nssStorage`, plus `storageFixtures`) and `fixtureFetch(fixture)`,
a replaying fake `fetch` that records each request as `"<METHOD> <URL>"`. The fixtures follow each
server's public behaviour. They are not captured responses.

