<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-places

Private places history for Solid Suite. All RDF accessors, shapes and runtime manifests are generated from `codegen/places.ontology.ttl`, `codegen/places.shapes.ttl` and `codegen.config.json`. `src/model.ts` is a thin facade that validates a generated build before serialising and checks end time follows start time. There are no hand-written RDF model classes.

| Entity | Class | Properties |
| --- | --- | --- |
| Place | `https://schema.org/Place` | schema:name, address (text), latitude/longitude (double, bounded), category (home/work/food/shop/travel/outdoors/culture/health/other), description (notes), identifier (Google place ID); places:saved; dct:created/modified |
| Visit | `https://jeswr.org/ns/places#Visit` | schema:location (absolute Place subject IRI), startTime/endTime; places:confidence (decimal 0–1); dct:source (google-timeline/manual/photo/check-in); schema:description (notes) |
| Journey | `https://jeswr.org/ns/places#Journey` | schema:startTime/endTime, distance (metres); places:startLatitude/startLongitude/endLatitude/endLongitude, activityType (walking/cycling/running/driving/train/bus/flight/ferry/other); dct:source |

`schema:` is `https://schema.org/`, `dct:` is `http://purl.org/dc/terms/`, and `places:` is `https://jeswr.org/ns/places#`. The shared Type Index library canonicalises schema.org registrations to the HTTPS spelling and accepts both spellings for discovery. Generated read-only aliases follow suite-vocab's `http://schema.org/` legacy namespace for Place's type and its unshared fields, Visit's place link, and Journey's distance. The generator rejects aliases on predicates shared across entity shapes (`description`, `startTime`, `endTime`). Legacy Place records therefore load, but legacy notes are not projected and HTTP-only Visit/Journey dates cannot be read; these records are counted as skipped. Existing triples are preserved on edits. Re-import the source export to create canonical visits/journeys. Widening shared-predicate alias support requires a generator follow-up; no manual RDF migration is performed. Place aligns to the federation core Place class. The core sector's Place shape is unconstrained; this profile adds required name, coordinates, category and saved flag, selects text addresses and flat coordinates, and limits fields to single values. No visits/journeys sector profile exists.

## Connector-facing pure parser

```ts
import { parseGoogleTimeline } from '@jeswr/solid-places/timeline';
const preview = parseGoogleTimeline(jsonText);
// { places: [{ id, data }], visits: [{ id, placeId, data }],
//   journeys: [{ id, data }], skipped }
```

The `./timeline` subpath loads only pure parser/distance code. No fetching, geocoding, telemetry, browser storage or pod mutation occurs in this function. It is synchronous and can run in a worker. Dates in `data` are JavaScript Dates. The future Google Timeline connector can wrap this function directly.

Supported formats:

- On-device `semanticSegments`: `visit.topCandidate.placeLocation.latLng` degree strings, top candidate place IDs/names/probabilities, activity endpoints, distance and activity types. HOME/WORK semantic candidates supply friendly names and categories; other unnamed modern places get a coordinate label. `timelinePath` point/latLng strings (including `geo:`) supply endpoints and summed distances only on an explicit activity when its endpoints/distance are absent. Path-only segments are raw traces and are skipped, preventing overlapping phantom journeys.
- Older `timelineObjects[].placeVisit` and `.activitySegment`: E7 latitude/longitude and start/end timestamps or millisecond timestamps. Old visit confidence percentages are normalised to 0–1.

Duplicate keys use Google place ID, otherwise coordinates rounded to five decimal places plus a case-folded name. Visits use place key and normalised start/end instants; journeys use normalised instants, endpoints and mode. Ordering does not affect identity. Duplicate records are dropped within a file. Coordinates and times are validated; invalid rows increment `skipped`. Unrecognised documents, invalid JSON and exceeded budgets reject. Nonnegative finite supplied distances take precedence; path distance or haversine is the fallback. This is export interpretation, not evidence that an inferred visit actually happened.

Hard budgets: 32 MiB UTF-8 input, 50,000 top-level records and 200,000 processed path points. Maps/Sets keep deduplication linear in input size. Names and external IDs over 256 UTF-16 code units are skipped rather than truncated, preventing identity collisions. Other text metadata is trimmed/capped; coordinate strings and date strings have small caps. No raw source file is persisted. Imports do not make any request to Google.

`haversine`, `coordinates`, `localDay`, `dayBounds`, `periodBounds`, `timelineForDay`, `groupByDay`, `placeVisitIndex`, `periodStats` and `mapLinks` are pure helpers. Day grouping keys use the browser’s local calendar dates (Intl); daily views also include overlapping overnight records. Periods are half-open local calendar ranges, including daylight-saving days of 23 or 25 hours; storage instants and month shard names remain UTC. Journey distance is apportioned by elapsed time at period boundaries, which is an estimate rather than reconstruction of a track. No reverse geocoding is performed.

## Private repository

`openPlacesRepository({ fetch, storageUrl, owner, storage? })` creates one account-scoped repository. Inject an account’s existing StorageClient, or omit it to use the public storage-client factory. The package never selects a backend. The suite app injects its client in every session mode; its explicit demo transport completes the older fixture’s missing discovery headers before going through the same public factory. `createPlacesRepository(storage, fetch, owner)` accepts an injected StorageClient for tests.

Call `initialize()` before `load()`, `savePlace(record, patch)` or `importTimeline(preview, onProgress, signal)`. Inject the account's authenticated fetch. Supported real storage is Solid with verified WAC. ACP, LWS, unknown/unreadable ACLs and non-owner grants fail closed through the shared `checkOwnerOnly`. It proves privacy, not the caller’s ability to write; the server enforces write/control permission. The demo pod does not enforce permissions; its fictional fixture still exercises the ACL verification path.

Data layout:

- `places/places/<sha256>.ttl`
- `places/visits/<yyyy>/<mm>/<sha256>.ttl`
- `places/journeys/<yyyy>/<mm>/<sha256>.ttl`

Monthly shards are required by the Places app contract, bounding historical listings per month. Loading discovers shards through bounded listings; the first cut loads the entire collection (100,000 resource limit), so very large histories need later lazy loading. RDF documents are capped at 128 KiB/2,000 quads and listings at 4 MiB. `load().skipped` counts malformed, oversized, unreadable and non-private files; valid records still load and the app shows a notice. Container/listing failures and the total resource cap still fail the view closed.

Every folder is sealed while empty, then verified through `@jeswr/pod-access` before sensitive data is written. Existing shared folders are refused. Container proofs and their ACL observations are cached per repository session, and sealed month folders are reused during imports. `initialize()` clears those observations and revalidates them. File ACL overrides are always checked with the shared helper; cached container defaults are reused for inheritance. These are session observations, not a lock on permissions: reopen Places after changing container ACLs elsewhere. No ACL suffix is guessed. An empty folder may be left behind after a failed setup, but no history is saved there. A private Type Index registration for Place uses `@jeswr/pod-type-index`; its writes are guarded too. A publicly readable profile that needs a new private-index pointer must be provisioned through the account settings first; this first cut refuses to write through public profile access rather than weakening the privacy check. Existing private index pointers work normally.

Import keys are hashed with Web Crypto SHA-256 before becoming file names. Writes use create-only exact names; existing typed records are kept, preserving manual names, notes, saved status and categories across re-imports. Imports are serial, yield every twenty records, report progress and accept cancellation. A cancelled/failed import can leave a partial batch; retrying the same input skips committed records. Place edits apply a generated field delta to the existing dataset, preserving unmodelled triples and unedited RDF terms. They require one observed strong or weak ETag (kept verbatim in If-Match), reject concurrent edits and reconcile follow-up validators against their matching body.

No map tiles or remote location lookup is part of this package. `mapLinks` only constructs URLs. The app asks for explicit per-place consent before embedding OpenStreetMap, and explains that OpenStreetMap receives the coordinates.

## Generation and validation

Use Node 24. `pnpm run codegen --update-lock` intentionally updates inputs and `src/generated`; never edit generated files. The drift test invokes `pnpm run codegen --out <temporary-directory>` and compares every artifact byte for byte. Build copies generated JavaScript and declarations beside the compiled facade. Root workspace tooling supplies Biome, TypeScript and Vitest. This package is security critical; its gate enforces 100% statement, branch, function and line coverage of hand-written source.

Generator gap encountered: `sh:maxLength` is rejected by closed admission. The profile omits it; importer/UI text limits and bounded RDF reads provide operational size bounds without hand-writing accessors or modifying the generator. Generated files retain the generator's fixed provenance header.

## Deferred work for the lead's tracker

- Direct Takeout ZIP import; extract JSON before importing in this first cut.
- GPX/FIT/TCX via the connectors thread in `@jeswr/pod-connectors`.
- Photo-location ingestion from Photos.
- Reverse geocoding, city and country totals.
- Live location recording.
- Track maps and multi-place maps.
- ACP/LWS private-storage verification and private-index bootstrap through public profiles.
- Lazy history loading and a durable, account-scoped offline write queue.
