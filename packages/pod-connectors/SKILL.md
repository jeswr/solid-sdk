---
name: pod-connectors
description: Use when maintaining source adapters, injected PodWriter/SourceAuth ports, connector configuration, registry, PKCE, file imports, or connector fixture tests.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Maintain Pod connectors

Spotify file import shares the live `spotify` id: use `fileAdapterById('spotify')`; read README's Spotify section
and `src/spotify/file-adapter.ts`. Reuse the streaming JSON scanner and Takeout ZIP reader, retaining their
grammar, byte, CRC/range and inflation checks. Stage only allowlisted history fields before any writes. Never
persist IP, country, device, raw export or filename, and skip `incognito_mode: true` (Private Session) rows as
skips. Basic repeats in one minute get a per-file occurrence in their id. Plan every month (reads, part assignment,
limits) before the first write. Keep merged month documents inside the connector container (`spotifyHistorySlug`:
`YYYY-MM.ttl`, then contiguous `-part-N` under the `SPOTIFY_FILE_LIMITS` play/byte/part budgets), with SHA-256
timestamp/track-or-name ids. Read a month's parts before writing: stored plays never move. Write each play through
`@jeswr/solid-listening`'s `addScrobble` (the generated model) at `#scrobble-<id>`/`-instant`, sharing per-document
track/artist/album nodes whose hash keys cover every value they describe; never add hand-written media accessors to
`spotify/vocab.ts`. Canonicalize the built store with `canonicalizeJeswrDataset` before `ctx.write` (the model
emits legacy w3id media/core terms). Suite Music's `data/spotify-history.ts` mirrors the slug and part limit and
folds imported duplicates. Keep short plays: the existing scrobble importer has no duration cutoff. All archive
entries share row, retained-text and month budgets. Count invalid, oversized and duplicate rows. Suite Connect
reads these shards in Music and saves personal public Spotify client IDs through suite-sdk preferences
(`connect.spotify-client-id`); the host client id wins. Preserve the existing live adapter, transport isolation and
PKCE refresh behavior.

Read README.md and src/core/types.ts before changing the public contract. The package was moved from
apps/pod-manager/src/lib/integrations; retain registry/types exports and the app's compatibility shims. Hosts
create an isolated createRegistry(config). Never install host-specific global configuration here. Environment
access is confined to the Node-only VeSync credential reader and the CLI host's CONNECTOR_VAULT_KEY for explicit
--vault opt-in (CON-A1). The CLI deletes the key from process.env right after reading it.

Runners receive PodWriter and SourceAuth explicitly. Every adapter uses ctx.api for source I/O and ctx.write for
Pod I/O. Keep credentials on their own transport. Fetch-backed and storage-backed writes are confined to the
adapter container; Type Index documents must be within a `pim:storage` or `solid:storage` root advertised by the
user's WebID, independently of the import destination. Preserve ETags and conditional PUT semantics. Enforce run
cancellation at the writer boundary (`core/abort.ts`): runImport wraps the PodWriter so each port checks the signal
immediately before it starts, and createFetchPodWriter's `signal` checks before every request; never rely on a
check at session entry, which can await a read before its write. Runners allow one run per connector container at a
time (an overlapping run in the same process is refused); hosts sharing a pod across processes must serialise runs
of the same connector. Use typed RDF wrappers and N3 Writer, never inline quads. Hosts pass the canonical
`profileDocumentUrl` from their existing profile load into createFetchPodWriter. Pin profile reads and updates to
that document while keeping the WebID as the RDF subject. Do not resolve redirects or fetch an unauthenticated
profile during registration; authenticated profile and Type Index operations refuse redirects. Source API,
document-bound fetch wrappers, and the fixture recorder use guarded-fetch's `snapshotFetchInput` to snapshot
Requests before validating their URLs and forward the snapshots, preserving effective bodies and policies. Mutable
URL inputs become checked strings before any asynchronous transport work. Recorder and Type Index wrappers use
`forward: true, initSemantics: "direct"` and forward `snapshot.init`, including inherited/non-enumerable
RequestInit members. Source auth reads `init.headers` directly before its single spread capture (`initSemantics:
"spread"`), matching its original mixed lookup semantics; never reread the original init after capture.

Use `createStoragePodWriter` with a Solid backend. Reads and registration use `readRdf`; exact-URL
creates preserve mail's colon-containing names. Updates require a strong ETag. Omitted conditions use
a fresh HEAD validator or create-only when absent. Propagate 412s. For deletes, only 404 means absent.
Both writers share slug and media-type validation in `core/pod-writer-policy.ts`. Registration needs
`webId` and `typeIndex.profileDocumentUrl`. Optional `storageFor` selects a client for those exact documents.
Preserve typed wrappers, conditional bootstrap and remote-context refusal. Hosts supply freshness policy.
The writer checks cancellation before dispatch and aborts reads. Dispatched private mutations finish.

All tests use recorded fixtures and memory Pods. Shared `demoImport`, `sparseImport` and `fileImport` helpers
default to the strict storage-client memory backend, retaining synchronous snapshots for existing adapter
assertions. `createMemoryPod` remains available for HTTP fault injection; `createStorageMemoryPod` exposes the real
memory StorageClient. Run the shared writer contract against fetch, Solid HTTP and strict memory backends. Use
./testing for consumers; run lint, build, typecheck, test and workspace gates.
CON-A4 adds `google-health` as Fitbit's Google OAuth successor. Read its README section
and `src/google-health/api.ts` before changing it. Every Health endpoint, filter, field,
unit and scope stays in that one module and quotes its source, the v4 discovery document
(revision 20261110). Anything that document does not state keeps a VERIFY note. Never
reintroduce a synthetic payload profile. The types are `steps`, `distance` and
`total-calories`, which use `:dailyRollUp` (POST, civil-date range, `windowSizeDays: 1`, page
size 90/14, at most 90 or 14 days). The others are listed: `heart-rate` and `weight` by
`{type}.sample_time.physical_time`, `exercise` by `exercise.interval.civil_start_time` widened
by 14 h, and `sleep` by `sleep.interval.end_time`. Exercise and sleep pages hold 25. Never
mix physical and civil bounds in one filter. Times are nested (`sampleTime`, `interval`), int64
values may be digit strings and offsets are Duration strings. `parsePoint`/`parseRollup`
separate an unrecognised `shape` from an invalid `value`. A proto3-omitted default is never a
shape: an absent `exerciseType` is `EXERCISE_TYPE_UNSPECIFIED` (imported), and an absent
`displayName` or stage type is a value refusal. Shape is judged per type across the run: more
than 10% of at least 20 points, or all of at least 3, stop only that type before writing the
crossing window, keep its checkpoint unchanged and warn `[google-health:unrecognised-shape]`.
Never fail the whole run for it. Invalid values (0 bpm, unknown enums, stages outside their
session) are skipped. Shared Google OAuth
accepts `health`; never reuse Fitbit tokens.
`TokenSet.scope` keeps the granted scope string; `SourceAuth.scopes` carries it to
`ctx.scopes` through runImport, and the adapter refuses partial grants. Hosts use the adapter's
`createSourceAuth` hook for one 401 refresh. Its transport forwards GETs plus only a bounded
JSON-string `dailyRollUp` POST to the Health origin, and strips `X-HTTP-Method-Override`,
`X-HTTP-Method` and `X-Method-Override` from every forwarded request. Map a 401 that survives the refresh, and
any 403 without a rate or quota reason, to `IntegrationAuthError` with re-authorise guidance.
Map a rate or quota 403 like a 429: retry, then `RateLimitedError`. Preserve transport
isolation, redirect refusal, byte caps, abort signals and memory-only tokens.
The standard writer, `adapterContainerUrl` and the Node state store (`connectorStorageId`)
deliberately resolve Google Health into the legacy `integrations/fitbit/` container. The
checkpoint lives in `state-google-health.json` beside Fitbit's untouched `state.json`; custom
writers must do the same. A Google session updates a legacy Fitbit row in place on any of
these: the same stored resource URL; a numeric id equal to the `logId` with starts within
14 h and the same wall clock or kind; the same UTC start and name; or the only legacy row at
the same wall clock to the second, whatever its name. v4 display names are generated
("Running" for a Fitbit "Run"), so never require names to match. Several rows at one wall
clock are told apart only by kind: the same name, or the Fitbit name → documented v4
`exerciseType` table in `mapping.ts` (`FITBIT_EXERCISE_TYPES`; its Fitbit names are VERIFY).
The wall clock comes from `civilStartTime`, else `startTime` plus `startUtcOffset`, and never
from the string's own offset. Otherwise a named session keeps `google-health-exercise-<id>`, so an
unrelated `logId` never blocks it. Ambiguous or repeated matches are skipped and counted with
an `onWarning` note; never guess them, and never throw for them. Key sleep by resource name
when present. Fitbit remains a deprecated fixture/demo oracle, excluded from the
new-connection catalog and refused by live runner/CLI. No Fitbit file path existed here.
List types walk one UTC day per window, chronologically, writing after each window. Daily
totals walk civil-date ranges up to UTC+14's today. First imports reach back `lookbackDays`
(30). The version 3 checkpoint keeps per-type `through` and `fetchedAt` and re-reads 48 h;
for totals, `through` is the last civil date that has ended everywhere. A version 1 or 2
checkpoint restarts at the lookback window. Points more than 48 h late are missed by design.
Per-type and per-run RunBudgets end the run successfully at the last written window. Only a
type whose first window cannot fit, or a real error, fails. A window at `maxPages` splits:
list windows into 12/6/3/1 h, rollup ranges by halves down to a day. Only the smallest window
over the cap stops that type, with a warning, and never fails the run. Hold a type at a window
only for points that can still change: an unfinished exercise (ending after the clock) that
started within 48 h or ends within 6 h after the clock, or an unprocessed sleep that ended
within 48 h. Older ones are final: write them as reported, never hold, and warn
`[google-health:stale-unfinished]` / `[google-health:stale-unprocessed]`. Ignore a point dated
after the clock (a later window owns it). A rollup 400 naming the range or its end is retried
once with the range ending the day after the run's UTC date. Documents
are day-partitioned. Heart rate is aggregated per minute (mean/min/max/`health:sampleCount`,
all sources), at most 1,440 entries per UTC day. Weight keeps per-source samples per UTC day.
Daily totals are named by the rollup's civil date; no UTC instant is invented. Sample keys
include the data source. Same-key conflicts resolve by latest `updateTime`, then the larger
value, never throwing. Preserve response/point/stage/token/page caps, bounded 429/5xx backoff,
abortable waits, deterministic upserts and conditional ETags. Demo fixtures, instants and civil
dates alike, shift by whole days into the lookback. Test against `syntheticHealthApi` in
`test-support/google-health-api.ts` (not shipped or exported), which rejects undocumented
requests. Other Health types and source
deletions are outside this import. All fixtures remain synthetic.

CON-13 takes every jeswr namespace base from `@jeswr/suite-vocab` (`NS`); assemble local
term names in the existing vocab modules. Keep standard namespace spellings exact,
especially mail's `http://schema.org/`. Confine `canonicalizeJeswrDataset` to import-session
reads (including custom PodWriter ports) and run provenance in the connector's own container.
Build its result in one pass, adding each unchanged or transformed quad without deleting
from a populated copy. Resolve suite aliases through `canonicalize()` before typed access
and reconciliation; restrict changes to vocabulary predicates and class values, preserving
resource identifiers, literal contents and standard IRIs. Rewrites of connector-owned
documents emit canonical jeswr terms. Keep `freshRdf` datasets raw: shared WebID profiles
and Type Index documents must preserve other apps' stored terms. Type Index comparisons
accept legacy classes without changing existing registrations; only new registrations use
canonical class IRIs. Keep the source-literal guard and legacy Pod regressions green.

The runner owns one shared-core `RunBudget` per import (20,000 requests, 2,000,000 records, 512 MiB JSON/inspected
response bytes and `maxDurationMs: 1_800_000` by default). It wraps `ctx.api` so every request is charged and every
consumed response chunk is metered. Do not create budgets or charge requests/bytes at adapter call sites. Use
`ctx.budget.items(n)` for all source rows before filtering, deduplication, buffering or mapping, including
malformed and deleted entries. Gmail counts list rows once, nested history changes and thread members. Factory
`adapter.limits` and host `runImport({ limits })` merge per key with the smaller defined value; undefined cannot
erase a bound. Keep direct adapter tests supplied with a budget, and use the runner for transport enforcement
tests.

Every source request receives the combined run deadline and caller cancellation. Headers have a 60-second timeout;
bodies have a 60-second per-chunk idle timeout and a finite absolute allowance of 60 seconds plus one second per
256 KiB of the reader cap or smaller valid declared length. `readBytes` supplies that cap to the source wrapper,
including Gmail raw and Drive content. Source deadline expiry permits Pod checkpoint writes; once `adapter.import`
resolves the deadline no longer fails the run (no post-adapter `checkTime()`; `ctx.progress` throws only on caller
cancel), so registration and provenance report the cursor. Explicit caller cancellation still stops all Pod ports.
Preserve effective Request/init signals, including Drive's per-download controller. Fetches and reader waits must
reject even if a custom transport ignores its signal. Cap Spotify Retry-After waits to `budget.remainingMs`.
`RunBudget.request()` and all other charges check the deadline; exhausted budgets stay exhausted. Keep independent
per-response/per-file caps. `getJson`/`postJson` only map HTTP errors and call the shared capped reader. Never let
a cancellation failure replace a status, byte-limit or deadline error. Drive uses these same JSON/binary body
helpers.
CON-A3.1 adds `./sync`: read the README's two-way section and `src/core/sync/types.ts` before
extending it. Existing adapters remain import-only. Sync hosts must supply the owner-only
`verifyPrivateDestination`/`confirmPrivateWrite` checks (sync connectors are private); route
every new direct Pod mutation in `sync/` through the runner's session-guarded `pod` port
(`session.raw`), never the raw writer, and keep `PrivateDestinationError` run-level.
TwoWayAdapter inbound mapping resolves
the pod URL with `ctx.sync.resolve(remoteId, prefix, idempotencyKey?)` before constructing
subjects; slugs are framework-owned (`<prefix>/<32 hex of sha-256(id)>.ttl`), never built
from raw ids. Then use `ctx.sync.upsert`/`delete`/`fail` with explicit remote versions,
tombstones and any provider-echoed create key. One mapped item per document; never silently
treat a collection document as an item. `fieldsForHash` is the single mapped-predicate
declaration: list every field inbound updates must change there, because unmapped incoming
facts only fill gaps (never overwrite). Hashing and merges cover only the item's own subjects
(document URL plus its fragments, or plus exactly `itemSubjects(url)` when declared) and the
blank closure their mapped quads reach; quads about other subjects are never hashed or
removed. A merge that removes pod quads absent from the incoming document trashes the
previous pod version first.
Keep the single shared import-session claim until outbound completes. Write-back and delete
propagation default off; explicit write grants gate execution. Remote methods use their
injected `options.api`, enforce conditional versions, and deduplicate durable create keys
(or declare `deduplicatesCreateKeys: false`, which defers unconfirmed creates). Three
provider rejections of a create (4xx other than 401/403/408/429) retire it as a manual
conflict. Preserve
original create payload snapshots through retries and later local edits. Never absorb a later
pod ETag into the baseline of an earlier outbound write. Owner protection precedes sensitive
body access; read sync resources through the session's `readResource(slug, false)` seam to
preserve ETags and normalize legacy aliases without retaining a run-long resource cache.
Isolate item failures with the fixed `SyncSkipReason` classes (never provider text); only
abort, budget, rate-limit, 401/403 and `LinkManifestLostError` end a run. Failed and deferred
inbound items stay in the owner-only manifest and in `pendingRemoteIds()`, which also lists
manual conflicts; an inbound failure without a valid remote id holds the cursor
(`cursorHeld`).
The first two-way run (no adoption marker) does a full inbound without the cursor; outbound
never creates an unlinked resource carrying this connector's import provenance. A keyless
unlinked inbound item is deferred only when its hash equals an open create that will still be
re-sent; adoption by echoed key requires the intent's hash (else a manual conflict). An open
create whose pod resource is gone and whose lookup misses is retired as a manual conflict.
Duplicate identities become manual conflict-only records; tombstone activity becomes a manual
conflict. A vanished link plus a new resource with the same location-independent hash, or one
whose subjects or PROV links name the old URL, is a move (reference pairs rebase verbatim
subjects and push an update). A run with an `unlinked-import` or an ambiguous move candidate
propagates no pod deletes: links are held as pending deletes and a second held run records a
manual conflict. A missing manifest beside existing shards is `LinkManifestLostError`, never a
new salt. Unsupported ACL discovery, absent
strong validators (per item), incomplete listings and malformed links fail closed;
sub-containers and non-RDF members are skipped. Link shards: 64 HMAC-salted base shards of 128
records with overflow documents, a 50,000-link hard cap that skips (never throws), and
tombstone GC after 30 days. Sync terms come from `CONNECTOR_SYNC` in `@jeswr/suite-vocab`.
Canonical hashing is exact and complexity-capped, including blank nodes. Keep loser snapshots
and 30-day trash markers, resume interrupted moves, and never infer a remote deletion from a
missing delta item. Notifications are finite hints; full scans remain authoritative. Keep
health details in owner-only links and the manifest, and counts in report/state.sync. Export
reference fixtures and the async `twoWayConformanceSuite(makeAdapter)` only through
./testing, not the production catalog; run it over full-listing and delta-only adapters.

Keep item accounting bounded by written documents: retain document counters, never run-long
subject identifiers. Replacement resets a document's count to its adapter-supplied local subjects
(excluding the document URL); merging adds only subjects whose previous stored provenance
does not name the current run. Removal drops the counter. Sector-map-added subjects stay
uncounted. Test the shared session through runFileImport after Takeout manifest release.
Keep run provenance a bounded summary: `MAX_RUN_SOURCES = 1,000` distinct source IRIs,
always adding the connector's own source first. The session's `maxRunSources` option may
lower that limit (minimum 1). Stop retaining origins once full while preserving complete
`prov:wasDerivedFrom` on each written document and item. Cover distinct item source URLs
across entries after reconciliation manifests are released, plus the persisted run summary.

Gmail continuing pages and full-sync budget failures (including duration) flush completed memberships then save a
private account-local journal with page token, completed IDs, initial history id and seen-message manifest. Skip
completed IDs; never resume by row offset or assume a message RDF write alone means its bytes and memberships
succeeded. An HTTP 400 for a saved token restarts the listing once, rebuilding seen IDs and retaining completed
IDs. Do not refetch completed raw payloads or double-charge list/raw messages. Save the journal after the last page
when it completed IDs, and clear it only through `ImportOutcome.commit`, which the runner calls after provenance
and `onState` (best-effort, holding the connector claim); never delete it inside `import`. Raw-message
`SourceTimeoutError` is skipped and counted like `ResponseTooLargeError`, but is not journalled as complete: it is
retried only when an interrupted full sync resumes (documented limitation; no Gmail retry list yet). Return its
original history id so mutations during partial runs replay next time. Bound retained reconciliation identifiers
across retries (2,000,000 identifiers / 16 MiB UTF-8 text). Never save a journal the Pod reader would refuse:
`JOURNAL_PERSIST_LIMITS` bounds the over-estimated serialised size and quad count, and a journal past it stops
writing (keeping the last saved checkpoint). A resumed completed ID is exempt from item accounting once per run;
repeats are charged. Spotify's 401 refresh is shared on its own controller: each waiter's signal cancels only its
wait, and the refresh aborts when every cancellable waiter has left. Test consecutive request-, item-, byte- and
duration-capped runs, incomplete message retries and final removal of vanished mail.

Successful Drive media/export copies consume the independent per-file cap rather than the run byte budget, because
content is committed per file. The central wrapper exempts only successful Drive representation endpoints; JSON and
inspected error bodies remain metered. Downloads still consume requests and deadlines. Only a source response
timeout becomes `contentSkipped: "timeout"`; run budget failures and caller cancellation must propagate. Timed-out
file ids persist in `drive/_content-retry.ttl` with attempt counts; incremental runs re-read and retry those their
change list omits, dropping a file after `MAX_RETRY_ATTEMPTS` (3). Retries are best-effort after the committed
change set: stop when `remainingMs` is within min(60 s, half the effective `maxDurationMs`) or on a caught
`RunBudgetExceededError` (the one place it is caught) and carry unreached entries; count any other per-file error
as an attempt. Return the cursor; only caller cancellation (a run-signal reason that is not a budget error)
propagates. Drop invalid or excess entries on load. Preserve unchanged-representation reuse and test that
request-capped retries make progress with content larger than the run JSON allowance.

`RunBudgetExceededError` extends `IntegrationSyncError`, reports `resource`/`limit` (including `duration`) and
explains that partial data may have been saved while the successful checkpoint is unchanged. Never catch it as a
successful truncated snapshot. Validate and snapshot limits. Keep the README audit current. Measure fixture
request/byte totals and independently count source rows for every adapter; require failures at N-1/M-1/B-1 and
success at N/M/B. This must detect missing item charges on the last endpoint. Cover stalled headers, bodies and
trickles per adapter, endless pagination and checkpoint retention with fixture-only fakes. Ordinary uploads retain
their 64 MiB actual byte / 100,000-row caps; Garmin uses `fileText`. Takeout retains its streaming caps.

CON-13 takes every jeswr namespace base from `@jeswr/suite-vocab` (`NS`); assemble local term names in the existing
vocab modules. Keep standard namespace spellings exact, especially mail's `http://schema.org/`. Confine
`canonicalizeJeswrDataset` to import-session reads (including custom PodWriter ports), the Spotify file adapter's
solid-listening output, and run provenance in the connector's own container. Build its result in one pass, adding
each unchanged or transformed quad without deleting from a populated copy. Resolve suite aliases through
`canonicalize()` before typed access and reconciliation; restrict changes to vocabulary predicates and class
values, preserving resource identifiers, literal contents and standard IRIs. Rewrites of connector-owned documents
emit canonical jeswr terms. Keep `freshRdf` datasets raw: shared WebID profiles and Type Index documents must
preserve other apps' stored terms. Type Index comparisons accept legacy classes without changing existing
registrations; only new registrations use canonical class IRIs. Keep the source-literal guard and legacy Pod
regressions green.

CON-02 adds the shared incremental write pipeline, host-owned ConnectorState, PROV activity recording and
per-adapter vocab-map.ts hooks. Preserve ETags on automatic merges and never advance checkpoints on failure. The
fixture recorder exposes only allowlisted non-personal JSON fields under configured public route prefixes; it never
saves headers or dynamic URLs. Detailed adapter mappings remain owned by their follow-on connector tasks.

Keep item accounting bounded by written documents: retain document counters, never run-long subject identifiers.
Replacement resets a document's count to its adapter-supplied local subjects (excluding the document URL); merging
adds only subjects whose previous stored provenance does not name the current run. Removal drops the counter.
Sector-map-added subjects stay uncounted. Test the shared session through runFileImport after Takeout manifest
release. Keep run provenance a bounded summary: `MAX_RUN_SOURCES = 1,000` distinct source IRIs, always adding the
connector's own source first. The session's `maxRunSources` option may lower that limit (minimum 1). Stop retaining
origins once full while preserving complete `prov:wasDerivedFrom` on each written document and item. Cover distinct
item source URLs across entries after reconciliation manifests are released, plus the persisted run summary.

Bank statements use `src/bank-statements/csv.ts` for both synchronous `parseBankCsv` and streamed imports. Detect
known normalized Revolut and Starling headers exactly, and Monzo by column name (required Transaction
ID/Date/Time/Type/Name/Amount/Currency, only known optional columns, Local amount/currency and Money Out/In in
pairs, no duplicates); unmatched headers retain the original generic aliases, values, dates, IDs and snapshot
behavior in `generic-csv.ts`. Explicit csvFormat constrains detection and disables fallback. Headerless HSBC UK
requires explicit `csvFormat: 'hsbc-uk'` and a stable user `accountLabel` via `createBankStatementsFileAdapter`;
hosts (the CLI's `--format`/`--account-label`, Suite's connect flow) validate input with the exported
`BANK_CSV_FORMATS` and `validateBankOptions`, never a copy of the rules. Labels are normalised once in `csv.ts`
(`normaliseAccountLabel`: reject bidi controls, prepended marks, noncharacters; strip Cc/Cf except joiners/tags
doing visible work; NFC; collapse whitespace; trim; 256 code points) and that string is both hashed and stored, so
never hash or store a raw label. Only the four bank CSV layouts use a label; OFX/QFX and generic CSV report it
unused. Keep all skipped bank-specific rows inside the source-row budget. Use exact decimal strings/BigInt for
bank-specific values, including signed Revolut Amount minus Fee; append a nonzero fee to the description as ` (fee
<fee> <currency>)`, omit zero fees. Descriptions need visible text after control stripping (solid-money rejects
others): fall back to the bank's own description/type columns (Starling joins only the visible Counter
Party/Reference parts), else skip and count the row. Validate the optional IANA timeZone; default to Europe/London
for zone-free Revolut timestamps and use compatible gap/repeat handling. Known-bank CSV dates reject invalid
calendars; OFX retains its lenient date parser and xsd:dateTime at UTC midnight. Bank-specific SHA-256 IDs exclude
filenames; HSBC uses a per-file identical-row occurrence index (overlapping exports rely on row order). Preserve
balances in fallback identity. `money-documents.ts` writes known banks only through `@jeswr/solid-money`'s
generated model (MoneyDocument/putAccount/putTransaction; never hand-written accessors or triples) to
`finance/bank/<bank>-<account-slug>/account.ttl` and `<YYYY-MM>.ttl` (+ `-part-<n>.ttl`), months from solid-money's
`monthKey`. Read each document, upsert by `#txn-<sha256>` and replace under the strong ETag from that read; compact
stored blank labels on read; pass the account document as `sourceUrl` (Suite Money rejects a non-http
`prov:wasDerivedFrom`). Plan and measure every document before the first write: `BANK_DOCUMENT_BUDGET` (2,000
transactions, 4 MiB N-Triples + provenance allowance, 1,000 parts) splits into parts, and otherwise throws
`BankDocumentBudgetError` with nothing written; never truncate. Per import, at most 50 accounts and 600 documents:
`BankMoneyPlan.add` fails while parsing (before any read), and every planning read counts (reuse the absent probe);
cap retained stored RDF at 32 MiB. Skip and count known-bank rows posted before 1970-01-01 or over a year ahead.
Writes are sequential; a failed write leaves earlier documents and a re-run converges. Account/month read errors
fail the import; only the legacy comparison read is advisory. No migration or legacy-subject cleanup. Generic CSV
and OFX retain the origin/main IDs, numeric/date policies, datatypes and replacement semantics in
`finance/bank-transactions.ttl`; the two layouts never touch each other. Reject near-miss bank headers sharing
three or more normalized names instead of generic fallback. All generic source rows, including skipped/malformed
rows, consume the row budget. Bank-specific CSV fields are capped at 16 KiB characters, amounts at 64 digits, and
the shared file/record/header/column caps still apply. Explicit format mismatches return bounded `unsupported`
diagnostics; abort closes the reader before any new Pod I/O. Generic CSV and OFX retain their original Invoice-only
mapping. Known banks share Suite Money's wire format but Money reads the storage-root `money/` tree: do not claim
this connector is visible in Money or escape the connector writer boundary. The README records this integration
gap, the layouts, the budget and every omitted bank field.

CON-14 adds the optional `PodWriter.writeBinary`/`remove` ports and `ctx.writeBinary`/`ctx.remove` for non-RDF
resources and source deletions. Keep binaries inside the connector container, never send RDF through it, default to
create-only, and replace only under a strong ETag.

CON-15 makes `@jeswr/pod-connectors/mail` the shared source for framework-free MAI-01 paths, vocabulary IRIs
(`src/mail/constants.ts`), `htmlToText`/`htmlToTextResult`, and MIME address conversion (`mailtos`). Keep constants
separate from typed wrappers and keep `./mail` imports free of `core/` and `node/` at module load; the writer
defers its existing provenance import to collision checks. Preserve `./mail` writer exports and `./mail/*`. The
suite adapts relative slugs with its existing validation, including dot document IDs and loose attachment
validation. The standalone pod-mail app shares only identical IRIs: never migrate its account-free percent-encoded
layout here. Keep app wrappers, store, operations, importer orchestration and Type Index code local. MIME
ID/date/References policies diverge and must not be merged. Contract tests cover layout, escaping, exact IRIs,
address groups, hostile HTML search bounds and a fresh public-entry import that refuses framework/Node-only
modules. Build before testing that published entry.

Keep the bounded ASCII-only `htmlToText`/`htmlToTextResult` scanner, surrogate-safe limits and
`HTML_TEXT_TRUNCATION_NOTICE` contract documented in [README's Mail
section](./README.md#mail-gmail-and-the-shared-mailwriter). Cover Unicode/skipped-block offsets, both bounds and
long leading comments through Suite's parseEmail/importMbox and connector MailWriter.

Mail sources (Gmail, Takeout mbox) go through `src/mail/writer.ts` so the pod-mail layout and vocabulary
(`http://schema.org/`, matching apps/suite's mail model) stay identical. Gmail supplies `documentId: "gmail-" + id`
and a source-native thread key; validate opaque ids against `[A-Za-z0-9_-]{1,256}` and skip invalid ones. File/mbox
imports keep Message-ID document ids with collision fallback and References/In-Reply-To ancestry. Gmail history
deletions resolve slugs directly; full syncs list the account's `messages/` container and sweep unseen Gmail
message RDF documents. There is no permanent Gmail source index; interrupted full syncs use the temporary journal
described above. Keep Spam/Trash in the full source listing. Resolve In-Reply-To through the writer's run-local
Message-ID map, then the optional `MailItem.resolveParent(messageId)` hook. Gmail resolves from validated thread
metadata via `ctx.api`/`getJson`, cached once per thread per run. Omit unresolved parent links for explicit
document ids; only Message-ID-keyed file imports retain the Message-ID-derived fallback.

Additions commit RDF, then `.eml`/attachment bytes, then thread/folder memberships in `flush()`. Retire dropped
attachments and remove a changed thread's old membership conditionally before replacing the RDF that records them;
flush only visits known threads. Deletions queue until 100 messages or `flush()`, which processes the remainder
before reconciliation. Read each queued message and each affected collection once per batch, listing stored folders
once. Persist all membership removals conditionally before deleting any message's attachments, `.eml`, then RDF.
Flush rereads its folder listing and each collection it reconciles; never reuse a deletion batch's dataset after a
write has cleared the import session's retained precondition. Keep each message document available for retries
until its cleanup succeeds; a missing document is a no-op. Reconcile all stored folders, including vanished labels,
so interrupted relabeling cannot strand memberships. Preserve one run per connector container.

CON-03 implements `./node` and the `pod-connectors` bin. Keep its imports separate from
browser entry points. Read `src/node/config.ts` and the README's Node CLI section before
changing the provisional MCP JSON schema. Open the 0600 owner-held config without following symlinks. Pass the bounded
`forClientCredentials` fetch to the Solid backend and `createStoragePodWriter`. Require both privacy
checks from `@jeswr/pod-access` for every `private` connector in `CONNECTOR_PRIVACY` (`src/core/pod-writer-policy.ts`; Garmin, WHOOP, activity-files, bank statements and more), their provenance and CLI checkpoints.
Classify every new adapter id there (`private` unless unquestionably public data); an unclassified id is private and `src/core/connector-privacy.test.ts` fails. ACP pods fail closed (no `acpDialect`). Reuse that one mechanism; never write a second verifier.
Confirm the same strong ETag across resource HEADs. Latch refusals before conditional create cleanup under its own 10-second deadline.
Keep `node/pod-auth.ts` as the adapter for the explicit token URL and exact cross-storage index grant.
Protocol discovery is cached and byte-capped, and only validated endpoints receive exchange
credentials. Separate immutable agent boundaries handle external index documents. The adapter
supplies local DPoP challenges for explicitly authorised requests so the engine authenticates
before any Pod operation; it never implements proofs, token caching or refresh itself.
Preserve transport separation, nonce retries, memory-only credentials and redirect refusal.
Keep cached index agents independent of caller signals; cancel individual waits and requests,
and evict rejected initialization promises only when they are still the cached promise.
Suppress stale profile results by epoch. Preserve serialized RDF strings as immutable Blobs
for both creates and updates so imports keep their adapter-specific size limits.
Preserve the effective request signal in the exported Pod fetch, including refresh and
nonce retry transports; reject already-aborted requests before sending. Use per-request
transport closures so concurrent callers keep separate signals, and compose any internal
signal with the caller's using AbortSignal.any.

Source login binds only `127.0.0.1`, with `/oauth-callback` as the fixed callback path.
`connectors[id].callbackPort` (also accepted by authorizeLoopback's NodeOAuthConfig) selects
a fixed port, validated as an integer from 1024 to 65535; omission uses an OS-assigned port.
Adapters with OAuth `requiresCallbackPort: true` (Twitch) require this setting for both
direct and proxy exchange: fail with a clear configuration error before opening the browser
if missing. Register `http://127.0.0.1:<callbackPort>/oauth-callback` with the provider; never
fall back to another port if binding fails. Validate Host, path, state,
and code before S256 exchange. Reserved OAuth parameters cannot be overridden. Always
close the listener on completion, timeout, cancellation, and errors. Keep access tokens in
memory. Persist refresh credentials only in the opt-in encrypted vault.
The state store installs owner-only grants from an advertised in-container WAC ACL before
accessing JSON. Keep ETags and create-only writes. Write a checkpoint after confirming its
payloads, and exit nonzero if saving or confirming it fails. CLI tests use fixtures and a
memory Pod. Only callbacks open loopback sockets. Keep raw server and exception text out of diagnostics.

Google Contacts (CON-05) writes the SolidOS vCard address book under `contacts/`, with `index.ttl#this`,
`people.ttl`, and `Person/<pathId>/index.ttl#this`. Use its typed wrappers; keep vCard as the write model (V10).
Register only the address-book class for `contacts/`. Encode email addresses for RFC 6068 with `encodeURIComponent`
on either side of the final `@`. Buffer every People API page and require the final sync token before applying
writes or deletions. Use the runner-owned `RunBudget` across all pages and retries, counting every buffered person.
Read 400 error details through the shared byte-capped `readJson` too. An expired token (410, or 400 with the
documented `EXPIRED_SYNC_TOKEN` error detail) discards partial increments and retries a full snapshot once. Retain
unchanged members on increments, remove source deletions with `ctx.remove`, and rewrite `people.ttl` once. Full
snapshots reconcile actual canonical person documents via `Container` listings, including unindexed writes left by
failed runs. Validate `metadata.previousResourceNames` with `personId` and conditionally remove former documents
and memberships. Keep malformed-person skip counting and the synthetic sorted Turtle mapping snapshot covered by
fixture tests. CON-06 adds `googleDriveAdapter` and `createGoogleDriveAdapter({ maxBytes })` (25 MiB default),
using the shared Drive OAuth configuration. Keep it Tier B. Files live at `drive/files/<pathId(id)>/meta.ttl`; tree
membership uses `schema:isPartOf` links to parent metadata subjects. Files are `schema:DigitalDocument`, folders
only `schema:Collection`; register DigitalDocument for `drive/` through `registrationContainer`. Typed Drive
accessors keep checksum/copy-state glue in suite-vocab's `NS.POD_DRIVE` (`https://jeswr.org/ns/pod-drive#`).

Capture the start token before full listing, stage every changes page before applying it, and only fall back once
on changes-feed HTTP 404/410. Reconcile absent files after a valid full listing; malformed envelopes, missing
arrays, or invalid pagination tokens must fail before pruning or checkpoint advancement. Use the runner-owned
RunBudget for every source request and page's item count; transport accounting bounds cumulative JSON response
bytes, including an expired-cursor fallback. Owned binaries require a known size under the cap; supported Google
Workspace exports have capped PDF/text responses. Read with a byte cap and cancel oversized responses. Stage
create-only `content-<v>[.pdf|.txt]` representations, where `<v>` is 24 SHA-256 hex characters of checksum, else
modified time, else downloaded bytes (the first representation for exports). Without source version fields,
download on every import. Commit their links through the conditional metadata write before deleting previous
versions; on failure, best-effort roll back staging without deleting currently linked representations. After every
store, reconcile canonical representation children through an @solid/object Container listing, including legacy
paths and orphaned exports regardless of previous encoding links. For deletions, conditionally rewrite existing
metadata first: clear all encoding links, set `contentSkipped` to `"pending-deletion"`, and retain the source id
and provenance. Remove representations next, then re-read metadata to conditionally delete it under the updated
ETag. Failed cleanup leaves a discoverable tombstone for replay or full reconciliation. Pending deletion or missing
expected encoding links must force a returning file to download again, even when its source version is unchanged. A
policy omission writes explanatory metadata without incrementing `skipped`. Drive tests wrap JSON `fixtureFetch`
with synthetic media/export responses; do not broaden fixtureFetch or call live Google APIs. True streaming bodies
await a future PodWriter port.

CON-08 extends the existing google-takeout adapter with signature-detected streaming ZIPs and legacy MyActivity
JSON. Read `src/google-takeout/dispatch.ts`, `zip-reader.ts`, `mbox.ts` and `readers.ts` before changing archive
behavior. Archives require `ImportFile.stream()` for signature sniffing plus `slice(start, end): { stream():
ReadableStream<Uint8Array> }` (exclusive end; native File/Blob). Never fall back to whole-file text/buffering.
Parse the central directory streamingly (64 MiB cap, 100,000 entries), including ZIP64 locator, record and extra
fields; reject multi-disk/structurally invalid archives before dispatch. Validate local headers,
names/methods/flags and non-overlapping data ranges before any writes. Stream exactly the central compressed range,
await downstream work after at most 64 KiB, and require DEFLATE completion at that boundary, declared size and
CRC-32. The pinned fflate Inflate completion/pending-state bridge needs boundary/memory tests on upgrade. Data
descriptors never frame content. Keep whole-file/message/Drive, total inflation and path-depth caps. The first
message header of the first valid mbox (64 KiB) alone selects Delivered-To; no second full archive pass. Never
fetch export URLs. The Node CLI supplies stat size and fs read-stream-backed ranges for streaming adapters; its
text port stays bounded, and MAX_FILE_BYTES applies to non-streaming uploads only.

Reuse `calendarEvents`, `personDocument`/`writeContactIndex`, Gmail's shared system-label map,
`DriveMetadata`/`binaryType` and `createMailWriter`; do not fork their mapping/layouts.
Escape every path segment with mail `pathId`, reject empty/dot/traversal/absolute paths,
and keep Drive metadata in a separate tree from copied source files. Raw Records.json is
unsupported; list unknown products on the report. Fit uses the existing ExerciseAction
activity model with typed daily metrics. Synthetic fixtures only, including a generated
>50 MiB stream and 100% branch coverage for reader/dispatch modules.

`FileImportContext.read` comes from the import session and preserves conditional-write preconditions. File adapters
may return `{ skipped?, unsupported? }` instead of void; surface both through ImportReport, count skips in state,
and allow unsupported-only reports. `streaming: true` bypasses the runner's whole-upload cap only when the adapter
enforces its own byte limits. Keep legacy JSON capped. Product snapshots reconcile deletions/replacements only
after all entries of that product succeed; otherwise merge successful items and retain earlier membership. An
archive-wide inflation limit makes every destructive product incomplete; an entry-count ceiling rejects before
dispatch. Reject nonempty vCards without a card, normalize TYPE tokens (including repeated TYPE and comma lists),
and rebuild recurrence properties from parsed, unquoted parameters for shared Calendar mapping. Complete empty
activity category documents are removed after reading their ETag; clearing-only imports succeed. MailWriter flushes
folders/threads once per run. Keep 100% branch coverage for zip/readers/dispatch; cover descriptor signatures,
CRC/size/DEFLATE boundary failures, overlap and ZIP64 offsets.

Deferred snapshot/contacts reconciliation shares one run budget: 1,000,000 retained identifiers and 64 MiB of UTF-8
identifier text (also charge retained contact names). Check each unique subject before retaining it, without first
materializing all quad subjects. On overflow, mark that product incomplete, report
`reconciliation-state-cap-exceeded`, release its manifests and continue adds/updates only; other products still
reconcile. Validate calendar BEGIN/END names with a stack (VCALENDAR > VEVENT, other components balanced and
skipped); reject nested vCards and missing/mismatched END markers as entry parse failures. Charge actual inflater
output before any size/CRC/boundary rejection, including failed entries and mailbox-header sniffing, against one
shared 16 GiB budget. Exhaustion stops the archive with an error before deferred destructive reconciliation. Any
fflate decoder exception also aborts the archive, including during mailbox-header sniffing: it may have produced
internal bytes without invoking the accounting callback. Size/CRC/boundary failures detected by our own checks
still skip the entry. Only an activitySegment object is a recognized non-visit location row; malformed placeVisit
values (including missing/invalid location or duration) and all other row shapes count as skips and make location
incomplete. Contacts use an independent run-level row counter, including duplicate cards, across retained and
capped paths; manifest release never resets the counter. Excess rows skip before any Pod writes.

## WHOOP hybrid

`./adapters/whoop` exposes the Tier A OAuth adapter/factory and streaming file adapter under the single `whoop`
catalogue id. Default token exchange uses a proxy; Node hosts may inject a secret for direct exchange. Do not
assume public secretless exchange. Read `src/whoop/{adapter,file-adapter,model,vocab}.ts`, the README's WHOOP
section and `../solid-health/SKILL.md` before changing it. Reuse the Takeout ZIP reader; keep CSV normalized-header
collision checks, explicit-offset timestamps, native-id/CSV-start reconciliation and API-over-file precedence.
Source rows and normalized records are capped independently, including duplicate and malformed rows. Stage all
source parsing before writes. One RunBudget covers every API page. Item/request exhaustion commits a bounded batch
and returns a warning plus an opaque collection/page/offset cursor; only a completed traversal returns the ISO
start cursor, which replays seven days rather than an updated-since feed. A resumed page shorter than its saved
offset replays from row 0; a 400/404 on the resumed token restarts that collection once per run with no token
(never on fresh tokens). An empty completed traversal returns `COMPLETE_CURSOR`, never no cursor; file cursors and
`COMPLETE_CURSOR` start a fresh API traversal. Batch cursors keep `base` (the starting high-water cursor) for
Suite's partial-scope pinning via `pendingWhoopBatch`. No `offline` scope until refresh exists. Hosts print
warnings: keep them fixed strings. File batches use content-bound host-owned cursors and select newest-first with a
bounded heap; preserve the byte caps while scanning sort keys and the row/record caps while parsing selected rows,
including duplicates and malformed rows. A finished traversal returns the distinct `before: ""` completion cursor;
the next run of that export starts afresh (never return no cursor, or the session keeps an older partial one).
Scan-time malformed records are counted only in a traversal's first batch. The CLI keeps file and API cursors in
separate state slots (`fileCursor`/`cursor`), classifying a legacy shared cursor by shape. Physiological rows
remain atomic. Never invent a recovery time when its cycle is missing.

Workouts live in monthly `health/workouts/YYYY-MM.ttl` documents with stable id fragments; their container is
registered for ExerciseAction and (via `additionalClasses`) Observation. Shards must stay within solid-health's
exported `MAX_OBSERVATION_QUADS`/`MAX_OBSERVATIONS`, including session provenance. Generated wrappers validate
their whole store: never `mark()` one on a populated shard; build in a small store and merge, like
`buildObservation`. Health observations are built only through `@jeswr/solid-health`'s `buildObservation`;
`METRICS` holds the WHOOP mapping policy and `vocab.ts` only the schema:Dataset record marker. Never add a health
accessor class. A unit outside the profile's QUDT inventory carries UCUM only; a missing subtype or datatype is a
profile gap to report, not to hand-write around. HRV is RMSSD, not SDNN. Sleep stage totals are generic
observations so total sleep is counted once. Workouts retain ExerciseAction. Recovery score, strain and sleep
performance have no sector term: omit them and surface them through ImportOutcome/ImportReport.unsupported (now
supported for API adapters too). Keep journal entries unsupported. See the README for current Health UI, container
discovery and cross-month timestamp-correction limitations. Tests are synthetic only; never call WHOOP or add
dependencies. Preserve byte/row/record/quad caps and cancellation.

Garmin's `garmin` file adapter accepts full account ZIPs. Read `src/garmin/archive.ts`, `health-vocab.ts` and
[README's Garmin contract and maintenance constraints](./README.md#garmin-account-export) before changing it;
preserve its shared Takeout/file-json readers, limits, staging, ETag merges and existing sector vocabulary.
`createGarminFileAdapter` may only lower `GARMIN_ARCHIVE_LIMITS`. Keep the README candid about connector
chart-discovery gaps.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
VeSync is a CLI-only Tier B account adapter (`src/vesync/`), not OAuth. Read the
README's "Connect your Levoit purifiers" section and `src/node/vesync-auth.ts` before
changing its protocol. The Node-only credential reader accepts only VESYNC_EMAIL /
VESYNC_PASSWORD, consumed once, deleted
from the process environment, password immediately MD5-hashed. Hidden prompts never
echo. No credentials, hashes, account IDs or tokens enter reports, errors, pod RDF or
state. Keep Node auth out of browser entry points and keep all source exceptions
sanitized. Only fixed HTTPS login/list/status routes are allowed; never forward
redirects, arbitrary methods, source URLs or caller headers with credentials.

Read status keys per pyvesync family (Core snake_case with `level`, Vital camelCase, LV-PUR131S top-level and
uuid-addressed; no Core 200S air readings) and treat only an explicit login rejection as an authentication failure;
transport faults stay retryable. Use solid-environment builders and path helpers. Derive sensor slugs as an
HMAC-SHA-256 of cid/uuid keyed by the connector's `environment/` container URL (stable per pod, unlinkable across
pods); never persist raw identifiers in IRIs. Preserve per-sensor UTC day appends, minute identities, room/purifier
feature distinctions, bounded numeric readings, and default model limits including malformed roots. VeSync
documents set `requirePrecondition`: the shared session must reject existing resources without strong ETags. Do not
advance checkpoints after source/Pod failures. Log and count capped-day skips. The adapter opts into a 32-activity
provenance history cap; other adapters retain their existing history semantics. Watch mode rereads protected state
each cycle, serializes imports, backs off with jitter, and classifies failures by cause with
`classifyVeSyncFailure` (`src/node/vesync-failure.ts`): transient source/network/Pod 5xx-408-412-429 and transient
`StateStoreError`s retry; VeSync login rejection, Pod 401/403 and other 4xx, `PreconditionUnsupportedError` (weak
ETags), structural state problems and config stop. Hidden prompts enter raw mode before the label and always pause
stdin afterwards. Any unexpected non-zero data code clears the VeSync session so the next cycle logs in again. Keep
catalogue `cliOnly` / `cli-only` visible without approval flags and show terminal instructions instead of an OAuth
flow. Test synthetic shapes only, with no provider traffic, including password safety, re-login bounds, source
budgets and aborts.

CON-A6 adds Tier C `activity-files` (`./adapters/activity-files`): content-detected GPX/TCX/FIT and mixed ZIPs
through the existing Takeout reader. Read `src/activity-files/{file-adapter,model,xml,fit,mapping,vocab}.ts` before
changing it. Keep the independent synthetic FIT encoder in `test/activity-fixtures.ts` test-only. Never add
provider calls or dependencies. XML uses bounded `mini-xml.xmlEvents`, not the legacy whole-string block extractor;
reject DTDs and structural errors. FIT checks header/file CRC and every definition/data boundary, handles
compressed 32-second rollover and skips developer fields by declared size. Unknown fields/messages must preserve
alignment. Decode every declared field in order for normal and compressed headers alike; never require field 253. A
compressed header's offset (against the previous timestamp) wins over any decoded field 253, which is not a base.
File bytes, archive inflation, activities, parser messages, records and total points all have hard caps; factory
options can only lower them. Return fixed diagnostic codes through FileImportOutcome/ImportReport `warnings`. XML
scanning charges one message per 512 characters; at most 200,000 track samples stay retained per file. finish()
drops durations outside 1 s to 7 days with the end time and marks out-of-range (1970 to 2100) start/end invalid;
durations use at most 3 fixed decimals. TCX elapsed time is the trackpoint span, else lap start times; never the
timer sum. One activity's mapping failure is a skip; Pod port failures and cancellation fail the run. Store each
file's original lazily (memoised once per file) after an activity's skip and cap checks, so nothing is stored
unlinked. Origin IRIs are hash-only; the file name is only the original's `schema:name` (256 characters) plus hash
`schema:identifier`, on the origin IRI when the bytes exceed the binary cap. TCX trackpoint times may be unordered:
start is the earliest point (or `<Id>` if earlier) and end is exactly the latest point. Keep tracks at most 2,000
samples, preserve the capped original, and never match a truncated activity against a complete one. Use elapsed
duration and normalized sport for the two-second cross-export dedup check; retain the original anchor to avoid
drift. Dedup lookup is five bounded second buckets, at most 32 entries each, with confined activity targets. Source
histories also cap at 32. Files are add/update imports with no deletion snapshot or cursor. Conditional writes,
cancellation, run provenance and failed-state retention remain shared runner responsibilities.

CON-A1 exposes `./vault`: ConnectorTokenVault, key helpers, MemoryVaultStore and IndexedDbVaultStore. Keep it
browser-safe and independent of mcp-oauth. Only `./node` exports FileVaultStore. Read the README's encrypted
refresh vault contract before changes. Use WebCrypto AES-256-GCM, fresh 96-bit IVs, canonical `[1, connectorId,
account]` AAD and strict version/base64url parsing. Never expose underlying errors/causes, tokens or key bytes.
Preserve record, metadata, depth, node, ciphertext and store/list caps. Validate before stringifying untrusted
input; project plain data without invoking custom getters/toJSON. Unknown record fields and credential-shaped
metadata are refused. Files require private owner-held directories/files, no symlinks/hardlinks, bounded descriptor
reads, exclusive temp + fsync + rename + directory fsync. IndexedDB elects/stores its non-extractable key
transactionally alongside ciphertexts; wait for commit. That key is usable by a copied profile or same-origin
script (non-extractable only blocks export); getOrCreateKey({ passphrase }) stores only a PBKDF2-SHA-256 (600,000
iterations, 16-byte salt) AES-GCM-wrapped key, never mixes modes, and fails generically on a wrong passphrase. The
vault constructor refuses extractable keys. Tests use a minimal structured-cloning IDB fake without dependencies.

OAuth exchange/refresh accepts `{ vault, account, signal? }`; persist rotation before returning access tokens.
`getOAuthToken` restores on later runs; `createOAuthSourceAuth` shares refresh and retries a GET once. Token
requests never use the caller's signal: run them on a private controller with TOKEN_REQUEST_TIMEOUT_MS (30 s); a
pre-send abort prevents sending, a later one is honored with a generic AbortError only after the response is
validated and persisted (the CLI exempts token/revocation URLs from its signal merge). A code exchange without a
refresh token deletes the account's record. Disconnect best-effort revokes stored and session refresh tokens at an
RFC 7009 `revocationEndpoint` (Google declares one; others are manual), ignoring failures, before deleting locally.
Accept string scope or string-array scope normalized with join(" "); drop other scope types. Token
endpoints/proxies require HTTPS except HTTP on localhost, 127.0.0.1 or [::1] for development. Request JSON
(including GitHub); form token responses are unsupported. Spotify's legacy factory refuses a vault; vault hosts use
createOAuthSourceAuth.

Hold optional VaultStore/ConnectorTokenVault.withLock across reread + refresh + put/delete. Use the newest saved
credential; on invalid_grant compare before deletion and retry once with a newer credential, never loop. Current
invalid grants raise typed reauthorise; other failures retain records. Unreadable refresh records raise
UnreadableCredentialError (reason reauthorise), but fresh code exchange may replace them without decrypting the
previous ciphertext; the interactive CLI falls through to loopback login, interactiveLogin false exits 3. With a
vault a missing record means disconnected: an in-memory refresh token raises reauthorise; only vault-less sessions
fall back to it. Disconnect waits for its in-flight refresh then deletes under the account lock. Memory uses a
bounded per-key mutex; IndexedDB uses navigator.locks or a shared in-process fallback. Clear the IDB handle on
versionchange. Custom stores without locks require host serialization.

File stores canonicalize ancestor aliases once at construction, check the real path and refuse
final-directory/record symlinks. Windows construction throws the POSIX requirement. get/put refuse unsafe records;
list skips them; delete unlinks any current-uid regular record file regardless of mode, never a symlink or
foreign-owned file. Per-record O_EXCL 0600 locks break after 60 seconds by mtime, renew while active, wait at most
65 seconds and always release in finally. Stale takeover renames to `<lock>.<uuid>.stale`, unlinks only on a
dev+ino match, otherwise restores via link() (EEXIST: leave it to age out) and retries. Unlink a new lock failing
its safety check (dev+ino verified). Release failure never masks the callback outcome. Clean only own-pattern
regular current-uid temps and claimed `.stale` locks older than ten minutes at construction and before list/put
budgets; exclude them from the name budget and retain a separate bounded scan. CLI --vault without
CONNECTOR_VAULT_KEY exits 2 naming the variable; a key alone warns on stderr and continues in memory.
connectors[id].account defaults to default. Use fixtures for hostile/error paths and assert secret-free errors.
Deferred snapshot/contacts reconciliation shares one run budget: 1,000,000 retained
identifiers and 64 MiB of UTF-8 identifier text (also charge retained contact names).
Check each unique subject before retaining it, without first materializing all quad subjects.
On overflow, mark that product incomplete, report `reconciliation-state-cap-exceeded`,
release its manifests and continue adds/updates only; other products still reconcile.
Validate calendar BEGIN/END names with a stack (VCALENDAR > VEVENT, other components
balanced and skipped); reject nested vCards and missing/mismatched END markers as entry
parse failures. Charge actual inflater output before any size/CRC/boundary rejection,
including failed entries and mailbox-header sniffing, against one shared 16 GiB budget.
Exhaustion stops the archive with an error before deferred destructive reconciliation.
Any fflate decoder exception also aborts the archive, including during mailbox-header
sniffing: it may have produced internal bytes without invoking the accounting callback.
Size/CRC/boundary failures detected by our own checks still skip the entry.
Only an activitySegment object is a recognized non-visit location row; malformed
placeVisit values (including missing/invalid location or duration) and all other row
shapes count as skips and make location incomplete. Contacts use an independent
run-level row counter, including duplicate cards, across retained and capped paths;
manifest release never resets the counter. Excess rows skip before any Pod writes.


CON-A8 adds transactional schema.org email markup to `./mail`: `extractEmailMarkup`,
`createMailMarkupWriter`, `rescanMailMarkup` and their public types. Preserve the closed
schema/type/property allowlists and all byte, element, depth, node, script, string and item
caps. Tokenization must stay forward-only, with ASCII folding that preserves source offsets,
quoted attribute handling and raw/comment skipping. Never resolve JSON-LD contexts or itemref;
foreign/redefining contexts must not reinterpret compact terms as schema.org. Keep parsing
and typed RDF vocabulary modules free of runtime `core/` and Node imports.

Gmail and Takeout use `createMailWriter` with extraction on by default; factory options
can opt out or lower limits. Store source RDF and bytes first. Hash booking identities as
[type, senderKey, provider, number], otherwise message/index. Sender keys use the verified
aligned domain or unverified From domain; malformed/missing From remains message-local.
Google evidence is positional: walking headers top-down, every Received above the first
mx.google.com Authentication-Results must be a Google hop (by <host>.google.com with SMTP,
ESMTP, ESMTPS, SMTPS, UTF8SMTP or UTF8SMTPS, or by <IP literal> with SMTP id; never
authenticated submission or LMTP), the last being the inbound MX receipt `from ... by
mx.google.com with ESMTP|ESMTPS|SMTPS|UTF8SMTP|UTF8SMTPS`, directly above the assertion. Any other
hop, a Google POP3/IMAP/HTTP receipt, an unparseable trace or an assertion above the receipt
is unverified. Tokenize per RFC 8601 (quoted strings and CFWS comments) before splitting
result clauses, failing closed on a `"` inside a comment or `(`, `)` or `;` inside a quoted
string; require a single DMARC pass with one unquoted matching header.from, ignoring
later headers and other authserv-ids. Unsupported syntax in the first Google header fails
closed; never fall through to a lower duplicate. Preserve trusted host evidence. Persist sender key/trust and
receiver modification time on message RDF for re-scan. Unverified assertions never overwrite
verified assertions; verified assertions can promote unverified assertions. Preserve ETags.

Clock comparisons use Gmail internalDate or Takeout's bounded mbox From_ separator date (UTC
when zone-less), falling back only when it is absent to the inbound MX receipt time under the
same positional rule, clamped at import time.
Missing time is unknown/epoch for comparison. Never use MIME Date or markup timestamps for
update ordering, including on re-scan; only new dedicated stored receiver metadata is trusted.

Cap extracted scalars at 256 Ki characters per email and independently cap intermediate
microdata values before normalization; retain what fits and flag truncation. Abandon an item while
building it once it exceeds 256 nodes or a running 64 KiB size estimate, before serializing;
still skip items over 64 KiB UTF-8 Turtle, enforcing the cap after session provenance too. Bound source IRIs to
8,192 characters before repeating them across nested provenance. Share item and PUT-attempt
budgets across all messages in createMailWriter/re-scan. Count only items accepted for writing.
Verified mail keeps maxTotalItems (default 2,000) and the per-message maxItems; unverified mail
is capped at 10 items per message and a separate maxUnverifiedItems (default 500, at most
maxTotalItems). PUT attempts (default 2,000) count failures and source inventory PUTs;
unverified PUTs also draw on maxUnverifiedWrites (default 500, at most maxTotalWrites). Decide
and size-check every item before the inventory PUT, list only accepted slugs, skip the
inventory PUT when nothing is accepted, and trim accepted items to the PUTs left.
Verified means DMARC aligned for the From domain, not a trustworthy sender. Catch extraction/markup write failures per message and report stable
codes through writer.errors and ImportReport.errors; keep importing emails and advancing the
cursor. Cancellation still propagates. Depth overflow must keep scanning later JSON scripts.

Persist a bounded fedcon:emailMarkupSlug inventory once per message before item PUTs (skip every
item write with markup-source-missing when the source message read returns nothing), preserve
it on replay without resetting this run's source-message counts, and delete only assertions currently derived from that message before deleting
its RDF. Cleanup runs even with extraction off; Trash retires markup while retaining mail.
Re-scan prune mode checks at most maxPruneItems (default 2,000) purchases/trips resources per
run in slug order after a cursor persisted in mail/<account>/markup-state.ttl (unregistered,
inheriting the account's owner-only access), advancing it while capped and clearing it at the
end, and removes assertions with missing source messages. Keep fixture helpers outside src so ./mail/* cannot expose them.
Cover all roots/encodings, adversarial auth/clock/parser cases, count-based amplification,
trust-update matrix, failure continuation, budgets, removal, prune and re-scan with fixtures.

`ctx.releaseRead(slug)` releases a read-only session dataset and its ETag, with no Pod I/O;
the next write to that slug must read again. Keep it optional for custom non-retaining ports.
Mail markup re-scan releases listing/message reads immediately, and the markup writer releases
skipped stale updates and protected verified records. Never release a read whose precondition
is still needed for a subsequent write; this port prevents mailbox-sized dataset retention.
CON-A2 adds root-exported ConnectorScheduler and owner-only JSON settings/state ports.
Read the README's Scheduled connectors contract before changing them. Those stores are
private writes: pass `privateDestination` (the PodWriter's verify/confirm ports) to
`createConnectorStateStore` and `createConnectionStore`, or every mutation refuses with
`PrivateDestinationError` before any request; never add a bypass. The CLI and scheduler
share one checkpoint file (`connectorStateLocation`) and one `connectorState` parser, and
each must keep the other's validated fields (`fileCursor`, `sync` / `accounts`, `claims`,
`health`). Preserve the
whole-container run claim even for different accounts, the continuous worker pool
(single-flight, cap, drain on stop), bounded connection/concurrency/JSON/retry limits,
transport cancellation, allowlisted health codes and legacy checkpoint projection.
Invalid settings rows are skipped one by one as `invalid-config`; one connection's
failure never rejects a tick. `health.counts` describe the latest attempt's document
changes; old `counts` remain the last successful import's document/item counters. Keep
account cursors separate (legacy cursor only for a sole connection; never rewrite root
checkpoint fields), merge fresh snapshots after 412, distrust timestamps more than five
minutes ahead (follow a trusted attempt's back-off; with none, a future-dated stored time
makes the connection due now; persist no future lastSync/connectedAt) and never roll
back a newer successful cursor. Reauth (or two consecutive 401s; 403 stays a backed-off
`forbidden` failure and never invalidates) is latched durably, recording the row's
`enabledAt` in `latchedEnabledAt`, until that value changes (string compare) or an
explicit setEnabled, which takes priority over pool claims for its container. The
latch's settings disable is conditional on the row's enabledAt being unchanged;
`saveConnection`/`update` resolve `"superseded"` when it was skipped. The in-memory row
is disabled only while it still carries the run-start enabledAt and the save was not
superseded; otherwise the current row stays untouched. `TokenSource.invalidate` runs
only for the grant in use for the rejected run, after an applied (or row-removed) save
with no superseding enabledAt; vaults discard only a token matching that grant.
Cancellation starts no further state/config I/O. Before the token fetch a run writes
an expiring claim (`state.claims[account]`, random holder, `expiresAt` = run limit +
2 min finish + 5 min skew) conditionally; a 412 or another holder's unexpired claim skips
quietly (no health), defers the connection until expiry, and only an expired (or
implausibly distant) claim is taken over; the outcome's persist releases it. Each run
is bounded by `runTimeoutMs` (default 15 min, 1 s to 2 h): its signal reaches token
source, Pod writer, runner and transports, waits are cut only at the limit (shutdown
still drains), and a timeout is a backed-off `timeout` failure; finishing I/O has its
own 2 min bound. `NoVaultError` skips the run (claim released, no health/latch/settings,
in-memory back-off). Validate a returned checkpoint before success; an unsavable one
falls back to a health-only failed attempt so back-off is durable. Ok/partial runs are
due at min(nextRunAt, lastRunEndedAt + interval). Owner-JSON ACL targets must be resource
ACLs beside the document, never containers or container `.acl`s. Owner-JSON stores protect their ACL
once per instance and on create, poll with If-None-Match, and `peek` is read-only.
The token vault is injected via TokenSource, with ReauthoriseError defined in core/types.ts.
Tests must cover fake-clock scheduling, source/Pod shutdown and conditional merge races.
The Letterboxd, Pocket, StoryGraph and Telegram file adapters (see the README section) take
every field bound from `core/export-fields.ts` and Goodreads/StoryGraph book identity from
`core/books.ts`; do not fork either. Letterboxd reuses the Takeout ZIP reader with an entry
allowlist and its own entry/inflation caps; keep it from inflating unselected entries.
Pocket writes the `@jeswr/solid-bookmark` wire format (`http://schema.org/url`), never
`PodThing.sourceUrl`, so provenance stays on the export. Telegram reads JSON keys as own
properties and records attachment names only; never open or resolve an export path. Keep
one document per independently exported unit (Letterboxd `media/letterboxd/<kind>.ttl`,
Telegram `social/telegram/<chat key>.ttl`, StoryGraph and Open Library one each): a
partial export must replace only what it covers, never earlier imports.
