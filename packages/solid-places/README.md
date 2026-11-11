<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-places

Private places history for Solid Suite. All RDF accessors, shapes and runtime manifests are generated from `codegen/places.ontology.ttl`, `codegen/places.shapes.ttl` and `codegen.config.json`. `src/model.ts` is a thin facade that validates a generated build before serialising and checks end time follows start time. There are no hand-written RDF model classes.

| Entity | Class | Properties |
| --- | --- | --- |
| Place | `http://schema.org/Place` | schema:name, address (text), latitude/longitude (double, bounded), category (home/work/food/shop/travel/outdoors/culture/health/other), description (notes), identifier (Google place ID); places:saved; dct:created/modified |
| Visit | `https://jeswr.org/ns/places#Visit` | schema:location (absolute Place subject IRI), startTime/endTime; places:confidence (decimal 0–1); dct:source (google-timeline/manual/photo/check-in); schema:description (notes) |
| Journey | `https://jeswr.org/ns/places#Journey` | schema:startTime/endTime, distance (metres); places:startLatitude/startLongitude/endLatitude/endLongitude, activityType (walking/cycling/running/driving/train/bus/flight/ferry/other); dct:source |

`schema:` is `http://schema.org/`, `dct:` is `http://purl.org/dc/terms/`, and `places:` is `https://jeswr.org/ns/places#`. The shared Type Index library canonicalises schema.org registrations to the HTTPS spelling and accepts both spellings for discovery. Place aligns to the federation core Place class. The core sector's Place shape is unconstrained; this profile adds required name, coordinates, category and saved flag, selects text addresses and flat coordinates, and limits fields to single values. No visits/journeys sector profile exists.

## Connector-facing pure parser

```ts
import { parseGoogleTimeline } from '@jeswr/solid-places/timeline';
const preview = parseGoogleTimeline(jsonText);
// { places: [{ id, data }], visits: [{ id, placeId, data }],
//   journeys: [{ id, data }], skipped }
```

The `./timeline` subpath loads only pure parser/distance code. No fetching, geocoding, telemetry, browser storage or pod mutation occurs in this function. It is synchronous and can run in a worker. Dates in `data` are JavaScript Dates. The future Google Timeline connector can wrap this function directly.

Supported formats:

- On-device `semanticSegments`: `visit.topCandidate.placeLocation.latLng` degree strings, top candidate place IDs/names/probabilities, activity endpoints, distance and activity types. `timelinePath` point/latLng strings (including `geo:`) supply endpoints and summed distances when activity endpoints/distance are absent.
- Older `timelineObjects[].placeVisit` and `.activitySegment`: E7 latitude/longitude and start/end timestamps or millisecond timestamps.

Duplicate keys use Google place ID, otherwise coordinates rounded to five decimal places plus a case-folded name. Visits use place key and normalised start/end instants; journeys use normalised instants, endpoints and mode. Ordering does not affect identity. Duplicate records are dropped within a file. Coordinates and times are validated; invalid rows increment `skipped`. Unrecognised documents, invalid JSON and exceeded budgets reject. Nonnegative finite supplied distances take precedence; path distance or haversine is the fallback. This is export interpretation, not evidence that an inferred visit actually happened.

Hard budgets: 32 MiB UTF-8 input, 50,000 top-level records and 200,000 processed path points. Maps/Sets keep deduplication linear in input size. Names and external IDs over 256 UTF-16 code units are skipped rather than truncated, preventing identity collisions. Other text metadata is trimmed/capped; coordinate strings and date strings have small caps. No raw source file is persisted. Imports do not make any request to Google.

`haversine`, `coordinates`, `dayBounds`, `periodBounds`, `timelineForDay`, `groupByDay`, `placeVisitIndex`, `periodStats` and `mapLinks` are pure helpers. Day grouping keys use UTC start dates; daily views also include overlapping overnight records. Periods are half-open UTC ranges; journey distance is apportioned by elapsed time at period boundaries, which is an estimate rather than reconstruction of a track. No reverse geocoding is performed.

## Private repository

`openPlacesRepository({ fetch, storageUrl, owner, demo })` creates one account-scoped repository. Real accounts use the storage-client factory. Only the explicitly marked, non-enforcing suite demo transport uses the Solid backend adapter directly. `createPlacesRepository(storage, fetch, owner)` also accepts an injected StorageClient for tests.

Call `initialize()` before `load()`, `savePlace(record, patch)` or `importTimeline(preview, onProgress, signal)`. Inject the account's authenticated fetch. Supported real storage is Solid with verified WAC. ACP, LWS, unknown/unreadable ACLs, insufficient owner control and non-owner grants fail closed. The demo pod does not enforce permissions; its fictional fixture still exercises the ACL verification path.

Data layout:

- `places/places/<sha256>.ttl`
- `places/visits/<yyyy>/<mm>/<sha256>.ttl`
- `places/journeys/<yyyy>/<mm>/<sha256>.ttl`

Monthly shards are required by the Places app contract, bounding historical listings per month. Loading discovers shards through bounded listings; the first cut loads the entire collection (100,000 resource limit), so very large histories need later lazy loading. RDF documents are capped at 128 KiB/2,000 quads and listings at 4 MiB.

Every folder is sealed while empty, then verified through `@jeswr/pod-access` before sensitive data is written. Existing shared folders are refused. Reads and writes re-check advertised ACLs (including resource overrides), with scoped URLs and bounded ancestor traversal; no ACL suffix is guessed. An empty folder may be left behind after a failed setup, but no history is saved there. A private Type Index registration for Place uses `@jeswr/pod-type-index`; its writes are guarded too. A publicly readable profile that needs a new private-index pointer must be provisioned through the account settings first; this first cut refuses to write through public profile access rather than weakening the privacy check. Existing private index pointers work normally.

Import keys are hashed with Web Crypto SHA-256 before becoming file names. Writes use create-only exact names; existing typed records are kept, preserving manual names, notes, saved status and categories across re-imports. Imports are serial, yield every twenty records, report progress and accept cancellation. A cancelled/failed import can leave a partial batch; retrying the same input skips committed records. Place edits require the observed strong ETag and reject concurrent edits.

No map tiles or remote location lookup is part of this package. `mapLinks` only constructs URLs. The app asks for explicit per-place consent before embedding OpenStreetMap, and explains that OpenStreetMap receives the coordinates.

## Generation and validation

Use Node 24. `pnpm run codegen --update-lock` intentionally updates inputs and `src/generated`; never edit generated files. The drift test invokes `pnpm run codegen --out <temporary-directory>` and compares every artifact byte for byte. Build copies generated JavaScript and declarations beside the compiled facade. Root workspace tooling supplies Biome, TypeScript and Vitest.

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
