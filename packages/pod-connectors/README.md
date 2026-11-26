<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/pod-connectors

> Experimental — AI-agent-generated. Security-critical; private until conformance is gate-green.

Source API and export-file adapters extracted with history from Pod Manager. The default
catalog is unconfigured and uses recorded fixtures for demos. Browser entry points read no
environment variables. The host injects public OAuth client ids and token proxy URLs. The Node
CLI reads `CONNECTOR_VAULT_KEY` for explicit vault configuration, and its VeSync credential
reader handles the VeSync variables documented below.

```ts
import { createRegistry, createFetchPodWriter, runImport } from '@jeswr/pod-connectors';

const registry = createRegistry({ spotify: { clientId: 'public-client-id' } });
const adapter = registry.adapterById('spotify')!;
const report = await runImport({
  adapter,
  mode: 'demo',
  podWriter: createFetchPodWriter({
    adapterId: adapter.metadata.id,
    webId,
    profileDocumentUrl, // final profile document URL from the host's existing profile load
    podRoot,
    fetch: authenticatedPodFetch,
  }),
});
```

`createStoragePodWriter` uses an injected `StorageClient` and an explicit connector container:

```ts
import { createStoragePodWriter } from '@jeswr/pod-connectors';

const podWriter = createStoragePodWriter({
  storage, // Solid StorageClient, authenticated by the host
  container: new URL(`integrations/${adapter.metadata.id}/`, storage.root).href,
  webId,
  typeIndex: { profileDocumentUrl },
  signal,
});
```

The storage writer reads with `storage.readRdf`, serialises RDF through the existing N3
helpers, and preserves `ifMatch` / `ifNoneMatch: '*'` conditions. With no condition it
observes the current strong ETag or creates only when missing. Conflicts surface as
`StorageError` with status 412; they never trigger a blind overwrite or an automatic retry.
Binary create/replace and conditional deletion share the fetch writer's container and
media-type checks. Missing deletes are harmless; unreadable resources and missing or weak
ETags fail closed. Exact Solid creates preserve existing path spelling, including mail's
`system:inbox.ttl`. LWS's server-assigned identifiers cannot implement these deterministic
slugs, so the factory requires a Solid backend.

`webId` is optional for data-only operations. Registration requires it and `typeIndex`;
`typeIndex.storageFor(url)` can select a separately scoped client for the canonical profile
or the index validated against the profile's advertised storage. Selection, bootstrap and
registration logic are shared with the fetch writer, and these reads also use `readRdf`.
Pass the run's `signal` to the writer to stop new operations and cancel in-flight reads.
Hosts own cache policy; the Node transport forces revalidation.

Runs of every connector classified `private` (see the table below) require both `verifyPrivateDestination(url)` and
`confirmPrivateWrite(url, { etag })` on their `PodWriter`. Hosts with a storage client can
pass both checks from `createOwnerOnlyDestinationChecks` into the writer. The client transport
must honor the run signal during pre-write access-policy reads. For the storage-backed writer, also pass
an authenticated `cleanupFetch` independent of the run signal. The fetch-backed writer gets
that transport in its existing `fetch` option and applies the run signal itself.

```ts
import { createOwnerOnlyDestinationChecks, createStoragePodWriter } from '@jeswr/pod-connectors';

const checks = createOwnerOnlyDestinationChecks({
  podRoot: storage.root,
  ownerWebId: webId,
  openStorage: (signal) => openAuthenticatedStorage({ signal }),
  signal,
});
const podWriter = createStoragePodWriter({
  storage, container, webId, typeIndex: { profileDocumentUrl },
  signal, cleanupFetch: authenticatedFetch, ...checks,
});
```

The verifier checks the target's pod scope, the containing policy and any existing resource's
own policy. It creates missing containers empty under verified owner-only defaults, then checks
them before any payload write. The verifier's `beforeWrite(url, guard)` variant checks the
session's refusal immediately before each container creation. Only an explicit `true` permits
the write. Public, unreadable or unsupported policies fail closed. A dispatched private
mutation finishes even if the run is cancelled. Confirmation requires exact HEAD 200 responses
for the resource before, during and after policy discovery. They must report the same strong
ETag, matching the write's strong ETag if supplied. The effective policies of both the file
and its container must be owner-only.
Confirmation also covers run provenance and CLI checkpoints. The runners report no new
cursor or successful checkpoint until their preceding writes are confirmed.

A refusal blocks further mutations in the import before cleanup starts. Cleanup applies
only to a completed mutation that used a create-only precondition. It gets a fresh
10-second timeout and sends DELETE with `If-Match` using the write's strong ETag, or the
first confirmation HEAD's strong ETag if the write supplied no strong ETag. Without a strong
validator, the importer skips deletion. A DELETE 200, 204, 404 or 410 followed by a HEAD
404 or 410 confirms removal. A refused replacement is preserved because deletion would
erase earlier committed data. The import fails with `PrivateDestinationError` carrying
`phase: "after-write"`, the destination `url`, and whether removal was confirmed
(`removed`). The host warns that a file was written and may be visible to others.

The server can change access policy between the pre-write and post-write checks. A grant
opened and closed between those checks escapes detection, and someone could read the data
before cleanup.
Confirmation cannot detect an intervening revision if the server reuses a strong ETag for different states between the two HEADs.

Type Index registration retains the existing public-index fallback, which is tracked separately.

### Which connectors require a private destination

`CONNECTOR_PRIVACY` in `src/core/pod-writer-policy.ts` classifies every registered adapter id.
`requiresPrivateDestination(id)` is true for `private` ids; they follow the contract above
(owner-only verification before any write, after-write confirmation, clean-up, cancellation and
refusal precedence). A registry test fails when an adapter is registered without a classification.
An id outside the table (a host's own adapter, or one not yet classified) is private too:
`requiresPrivateDestination` fails closed, so its imports are refused until the host supplies the
owner-only checks, and a new adapter should be classified when you add it. The package's own unit
tests give a few fixture ids (`accounting`, `incremental`, `legacy`, `takeout`, `toy`) a test-only
exemption in `test/fixture-connectors.setup.ts`; nothing in the shipped package has one.

An import of a person's own account data is private unless the data is unquestionably public by
nature. No registered connector qualifies: `github` requests the `repo` scope and lists
`/user/repos`, which includes private repositories, so it is private as well. `public-ok` remains
available for a future connector that imports only such data.

| Class | Connector ids | Why |
| --- | --- | --- |
| `private` | `activity-files`, `apple-health`, `fitbit`, `garmin`, `strava`, `whoop` | Health metrics, heart rate, GPS tracks, original FIT/GPX/TCX files |
| `private` | `bank-statements`, `amazon-orders`, `uber` | Transactions, purchases, trips and fares |
| `private` | `gmail`, `whatsapp`, `google-contacts`, `google-calendar`, `google-drive`, `google-takeout`, `chatgpt` | Mail, chats, contacts, appointments, file copies, conversations |
| `private` | `discord`, `dropbox`, `facebook`, `github`, `goodreads`, `google-photos`, `instagram`, `linkedin`, `netflix`, `notion`, `pinterest`, `reddit`, `slack`, `spotify`, `steam`, `tiktok`, `twitch`, `vesync`, `x-twitter`, `youtube` | Account data of the person: file and page names, photo libraries, posts, listening and viewing history, messages, home sensor readings, repositories (including private ones) |

**ACP pods currently fail closed for private writes.** No `acpDialect` is passed to the owner-only
checks, so on an ACP pod `checkOwnerOnly` cannot represent the policy and every `private` import is
refused (Gmail, Strava, Calendar, Contacts, Drive and the rest of the table alike). Supplying a
trusted dialect belongs to later ACP storage integration; nothing falls back to an unverified write.

The Garmin note that sends nested FIT archives to `activity-files` therefore lands in an
equally protected adapter.

Suite and Pod Manager use `createSessionPrivateDestinationChecks({ fetch, storageUrl, webId, signal })`.
It discovers storage with the authenticated session fetch. For a legacy root without a
storage-description link, it requires WAC and a typed storage root before verifying the
destination policy. The two existing `*Verifier` factories still return the pre-write check.

Live imports take `sourceAuth: { fetch: authenticatedSourceFetch }`. The optional
`createSourceAuth(id, adapter, token, sourceFetch)` helper adds bearer and adapter headers.
The helper binds credentials to an HTTPS-only origin allowlist (default: static fixture route origins)
and refuses redirects; pass a fifth argument to supply additional API origins explicitly.
Hosts must capture a pristine `sourceFetch` before initializing Solid authentication and
pass it to `authorize(id, config, sourceFetch)` as well as `createSourceAuth`. Pass the
auth manager's separate `podFetch` to `createFetchPodWriter`; never use the patched global
fetch for source API requests or token exchange. Access tokens stay in memory; hosts may inject the encrypted refresh vault. A `PodWriter` binds a
connector container, resolves and reads slugs, writes RDF with `{ ifMatch }` or
`{ ifNoneMatch: '*' }`, and registers Type Index entries. A document's `forClass`, plus any
`additionalClasses` it holds, is registered for its container; the runner takes the extra
classes from the document, so a custom port need not echo them. The fetch-backed implementation
confines document reads, writes and every redirect hop to the connector container. Type
Index operations separately validate the profile-selected index against the WebID's advertised
`pim:storage` and `solid:storage` roots, independently of the import destination,
allow only that document (or the bootstrap target), and refuse redirects. The profile
read/update is pinned to the host-supplied canonical `profileDocumentUrl`, resolved after
redirects during the host's existing profile load. The WebID remains the RDF subject.
Registration never dereferences the redirecting WebID or makes an unauthenticated profile
request, and all authenticated profile and Type Index operations refuse redirects.
Every connector RDF read, including registration, rejects JSON-LD context URLs with
`RemoteContextRefusedError` on the fetch writer (storage-client reports `not-rdf`) and never fetches a context. Inline context objects remain supported.
Deterministic document paths and Type Index bootstrap
behavior are preserved. The runner
retains read preconditions for subsequent writes; explicit write conditions override them.

Entry points:

- `.`: contracts, runners, catalog, config factory, fetch-backed and storage-backed writers, errors.
- `./oauth`: PKCE, refresh, vault-backed source sessions and popup flow (only `authorize` touches `window`).
- `./vault`: browser-safe WebCrypto vault, memory/IndexedDB stores and key helpers.
- `./node`: Node CLI, pod-auth client-credentials Pod fetch, loopback source PKCE, state and file vault stores.
- `./testing`: recorded fixture fetch, memory Pod and import helpers; fail-closed fixture recorder.
- `./sync`: opt-in two-way sync framework and host ports (CON-A3.1).
- `./mail`: shared browser-safe mail primitives and the existing MailWriter (details below).
- `./mail/*`: individual primitive, MIME parser and typed-wrapper modules.
- `./adapters/<id>`: each source's existing adapter (OAuth or export-file).
- `./core/*`, `./pod/*`, `./<id>/*`, `./registry`, `./types`, `./file-adapters`:
  compatibility modules used by Pod Manager's thin re-export shims.

`pnpm --filter @jeswr/pod-connectors build` builds ESM and declarations. `test` runs all
fixture tests (shared adapter imports use storage-client’s strict memory backend), shared
writer contracts for both writers, and the environment-read regression test without production traffic.

## Run limits

`runImport` owns one shared `RunBudget` for every network adapter and wraps `ctx.api`:
requests are charged before dispatch, response bodies are metered as bytes stream, and
source calls receive the combined run, response-deadline and caller signals. Adapters
charge returned records through `ctx.budget.items()`. Pagination, retries, profile lookups
and expired-cursor fallbacks cannot reset counters or omit transport accounting.

| Run limit | Default | Meaning |
| --- | --- | --- |
| `maxRequests` | 20,000 | All source requests, including retries and downloads. |
| `maxItems` | 2,000,000 | Returned records, counted before deduplication, filtering or buffering. |
| `maxBytes` | 512 MiB | Cumulative source response bytes; successful Drive media/export copies use their separate per-file cap. |
| `maxDurationMs` | 1,800,000 (30 minutes) | Total elapsed time, including source waits and Retry-After backoff. |

Source headers have a 60-second deadline, and bodies have a 60-second idle timeout between
chunks. Bodies also have a finite total allowance: 60 seconds plus one second per 256 KiB
of the smaller of the reader's byte cap and a valid declared Content-Length (the cap alone
when the length is absent). Healthy large downloads can exceed 60 seconds; endless trickles
still stop. Pending fetches and reads reject even when an injected transport ignores
cancellation; their signals are aborted and bodies cancelled. Spotify caps Retry-After
waits to the remaining run time. Each JSON response retains its 32 MiB cap (Gmail raw-message
JSON uses its existing larger per-message cap). The run deadline stops source work while
allowing completed data and private journals to finish saving to the Pod. Once the adapter
has returned, the deadline no longer fails the run: Type Index registration and provenance
complete and the new cursor is reported (Pod finalisation is not bounded by `maxDurationMs`).
Explicit caller cancellation still refuses every subsequent source and Pod operation, and
progress reports stop only on cancellation. An adapter may return `ImportOutcome.commit` to
discard private resume state; the runner calls it after recording provenance and reporting
the successful state through `onState`, and ignores its failure.

Pass any subset through `runImport({ ..., limits: { maxRequests: 500, maxItems: 10_000,
maxBytes: 64 * 1024 * 1024, maxDurationMs: 300_000 } })`. Values must be non-negative safe
integers; zero allows none of that resource and omitted fields retain defaults. Factory
settings on `createSpotifyAdapter`, `createGithubAdapter`, `createStravaAdapter` and
`createRedditAdapter` combine with host limits per key using the smaller defined value;
undefined host fields cannot erase a factory bound. Each run starts fresh counters.
Hosts should call `runImport`, including fixture demos. Direct adapter callers must supply
a budget and a budgeted transport, as the runner does.

Duplicates, tombstones and malformed array entries consume item capacity too. Gmail counts
labels, history records and their nested changes, and thread members; a listed message and
its raw payload count as one message. Limits apply to source traffic; Pod reads, writes and
provenance use their existing storage protections.

Gmail journals a full sync's page token, completed message IDs, initial history id and
seen-message manifest inside its account container after each continuing page, after the
last page when it completed messages, and after a request/item/byte/duration budget failure. Completed message bytes and memberships are saved
before the journal. Retries skip completed IDs instead of refetching raw payloads or charging
their first row again (a repeat of that ID within the run is charged); incomplete message
writes are retried. Row positions are never used, so
deletions cannot shift an unprocessed message past the resume point. A saved page token
rejected with HTTP 400 restarts the listing once and rebuilds the seen manifest, retaining
completed IDs for reuse. The final sweep uses the retained manifest, and the original history id ensures
mailbox mutations during these runs replay afterward. Successful history state remains
unchanged until the complete scan and reconciliation succeed. The journal is removed only
by the runner's `commit` step, after the cursor has been reported; a run that fails or is
cancelled during the sweep or final membership flush leaves it, so the next run refetches no
completed payload. A raw message that exceeds its cap or whose response times out is
skipped and counted in `skipped`, keeping any stored copy. A timed-out message is not
journalled as complete, so it is retried only when the run is interrupted and a later run
resumes the full sync. Known limitation: once a full sync completes (the journal is
cleared) or a history replay moves the cursor past it, a timed-out message is not
re-attempted until the message changes or a later full sync lists it again. Budgets must fit the profile,
labels, one listing page and at least one message. The journal's reconciliation manifest is
bounded independently at 2,000,000 identifiers and 16 MiB of UTF-8 identifier text in
memory. A saved journal must also stay readable by the default Pod reader (16 MiB, 1,000,000
quads): the journal over-estimates its serialised size (absolute member IRIs in both the seen
and completed sets, plus framing) and, once that would pass `JOURNAL_PERSIST_LIMITS`
(16 MiB − 64 KiB, 999,936 quads), stops writing. The last saved journal, a consistent
earlier checkpoint, stays; without one the full sync is not resumable and restarts.

Drive's `createGoogleDriveAdapter({ maxBytes })` retains its separate per-file copy cap
(default 25 MiB). Successful media/export bytes are written per file and consume no JSON
run byte allowance; inspected error bodies still do. Requests, records, response deadlines
and the total deadline apply to downloads too. A per-response timeout saves metadata with
`contentSkipped: "timeout"` and continues to the next file; run exhaustion and caller
cancellation still fail the import. Timed-out files are listed in `drive/_content-retry.ttl`
(their metadata subjects with a timed-out attempt count, at most 10,000 entries) and an
incremental run re-reads each one that its change list omits (`files/<id>`, one request and
one item) and downloads it again. A file is dropped after 3 attempts that time out or fail
(`MAX_RETRY_ATTEMPTS`), after a successful or otherwise-skipped download, or on a 404.
Retries are best-effort after the change set is committed: none starts with less than one
response timeout (or half of the effective `maxDurationMs`, default 30 minutes) remaining; a
request, item, byte or duration budget failure among them stops retrying and carries the
remaining entries forward with unchanged counts; any other per-file failure (an HTTP error,
a Pod write) counts an attempt and a skipped item. The run still returns the new cursor;
only caller cancellation fails it, leaving the list unchanged. Foreign, non-canonical, malformed or excess entries are
dropped on load (and the list rewritten), never failing the run.

Codegen exception: the retry list's `DriveContentRetry`/`DriveRetryEntry` accessors and
Gmail's private `FullSyncState` journal accessors are hand-written, like the existing
`DriveMetadata` and the rest of this package's models. pod-connectors has no codegen profile
(no `codegen.config.json` or SHACL profile, and no `@jeswr/federation-codegen` dependency),
and this private adapter state has no federation sector shape to start from. They move to
generated models together with the package's other models, tracked by the bead
"pod-connectors: move Drive vocab accessors to generated models". A request-capped retry reuses already-linked
unchanged representations and progresses to the remaining files.

Exhaustion throws `RunBudgetExceededError`, a subtype of `IntegrationSyncError`, exported
from the package root and `./core/budget`. Its `resource` is `requests`, `items`, `bytes` or `duration`,
and `limit` identifies the allowance. Its message states: “Partial data may have been
saved; the checkpoint is unchanged.” The runner records an error and retains the previous
successful cursor, counts and sync time. Already committed documents may remain; retry
with a suitable limit. Buffered snapshots are only replaced after their source traversal
completes. A budget failure never represents a successful truncated network snapshot.

The complete adapter audit is:

| Source adapters | Traversal and bounds |
| --- | --- |
| Spotify, GitHub, Strava, Reddit, Discord, Twitch, Notion, Dropbox, Google Calendar, Google Contacts, Google Drive, Gmail | Paginated; one runner-owned request/item/byte/time budget spans all pages and resources, including retries and full-sync fallback. |
| Facebook, Fitbit, Garmin, Google Photos, Instagram, LinkedIn, Pinterest, Slack, TikTok, X/Twitter, YouTube | Existing first-page imports; all requests, returned records, bytes and elapsed time share the same runner-owned budget. Pagination support is unchanged. |
| VeSync | Device-list/status polling; runner-owned request/byte/time limits apply alongside stricter adapter-local caps described below. Device rows use the adapter-local item budget; host `maxItems` is not charged by this adapter. |
| Amazon orders, Apple Health, bank statements, ChatGPT, Garmin file import, Goodreads, Netflix, Steam, Uber, WhatsApp | Uploaded-file imports only; 64 MiB declared/actual byte cap and 100,000-record cap. Garmin also reads through the bounded byte reader. |
| Google Takeout | Uploaded-file import only; legacy JSON has 64 MiB/100,000-record caps. ZIP has separate streaming entry, inflation, product-row and reconciliation-state caps described below. |
| Activity files | Uploaded GPX, TCX, FIT or ZIP only. See Activity files below for file size, archive inflation, activity, record and parser caps. |
| Mail | Shared writer/parser, with no independent source fetch or pagination; Gmail and Takeout enforce source limits before handing messages to it. |
## Two-way sync framework (CON-A3.1)

`runTwoWaySync(adapter, connection, ports)` runs inbound then outbound under the same
per-connector import-session lock, abort boundary and host-owned checkpoint. Existing
provider adapters remain import-only; this framework does not enable their write-back.
The reference platform is exported only from `./testing`, and is absent from the catalog.
`catalogEntry(adapter)` projects optional `twoWay` container/scope capabilities for host UIs.

```ts
import { runTwoWaySync, createFetchSyncPodWriter } from '@jeswr/pod-connectors/sync';

const report = await runTwoWaySync(adapter, {
  account: 'account-key',
  writeBack: true,                 // default false
  conflictPolicy: 'lww',           // also manual, remote-wins, pod-wins
  propagateDeletes: false,         // default false
}, {
  podWriter: createFetchSyncPodWriter({ ...writerOptions, signal }),
  sourceAuth,
  scopes: explicitlyGrantedScopes,
  state: previousState,
  signal,
});
```

Hosts obtain incremental consent for `adapter.requiredWriteScopes` before turning on
write-back; the runner checks explicit grants before any I/O. `TwoWayAdapter<Op>` extends
`IntegrationAdapter` with `fieldsForHash`, account-relative leaf `writeBackContainers`,
`requiredWriteScopes`, `toRemote(resource)`, `applyRemote(op, options)`,
`findByIdempotencyKey(key, options)`, `deleteRemote(id, options)`, an optional
`itemSubjects(documentUrl)` and an optional `deduplicatesCreateKeys` (default `true`). Remote
methods receive the separate, bounded `options.api` transport and the run signal. Creates MUST
deduplicate `options.idempotencyKey`; a provider that cannot declares
`deduplicatesCreateKeys: false`, and the framework then never re-sends an unconfirmed create:
it stays `deferred` until the key lookup finds it. A create the provider refuses (a 4xx other
than 401, 403, 408 and 429) three times (`MAX_CREATE_REJECTIONS`) is retired as a manual
conflict instead of being retried forever. Updates and
deletes MUST enforce `options.ifMatch` using the provider's conditional-write mechanism. A
deleted remote item is an idempotent success for `deleteRemote`. `applyRemote` and key lookup
return `{ remoteId, remoteVersion }`.

### Mapped predicates and inbound updates

`fieldsForHash` is the adapter's single declaration of its **mapped predicates**: the canonical
hash covers exactly these, and an inbound update replaces exactly these. **Adapters must list
every field they want inbound updates to change in `fieldsForHash`.** Incoming unmapped facts
only fill gaps: they are added for a (subject, predicate) the resource lacks and never
overwrite or remove a pod value, so a provider-side change to an unlisted field never reaches
an existing pod resource.

Hashing and merging are scoped to the **item's own subjects**: the document URL plus its
fragment IRIs or, when the adapter declares `itemSubjects(documentUrl)` (at most 32 IRIs, for
example `` [`${documentUrl}#item`] ``), the document URL plus exactly those; and the blank-node
closure reached from those subjects' mapped quads. Quads about any other subject, such as a
`<#note>` the owner added beside a declared `#item`, are neither hashed nor removed, even when
they use a mapped predicate. A non-conflict inbound update removes the item's stored mapped
quads (and that blank-node structure) and adds the incoming ones; every other triple stays, so
owner annotations such as a pod-added `schema:description` survive remote edits. The merged
resource's mapped projection equals the incoming one, so hash and conflict logic are unchanged
by the merge. Whenever a merge would remove pod quads the incoming document lacks (an inbound
overwrite of a mapped value, or a remote-wins resolution), the previous pod version is first
copied to protected `<account>/trash/` with a 30-day expiry; a remote-resolved conflict
already keeps it as its conflict snapshot.

### Inbound contract

Slugs are framework-owned. Adapters call `ctx.sync.resolve(remoteId, prefix, idempotencyKey?)`
**before mapping RDF subjects**, where `prefix` is an account-qualified write-back container
slug (`account/items`). It returns the linked pod URL, the URL of a pending create carrying
`idempotencyKey`, or `<prefix>/<first 32 hex chars of sha-256(remoteId)>.ttl`; raw provider
ids never reach pod paths. Then call `ctx.sync.upsert({ remoteId, remoteVersion, modifiedAt,
idempotencyKey?, document })`. When the provider stores our create key (iCalendar UID, body
marker, ...), pass it as `idempotencyKey`: inbound then adopts the pending-create link instead
of minting a second pod resource, but only when the item's mapped hash equals the intent's: a
different item carrying our (visible) key is a third party reusing it, recorded as a manual
conflict on the intent and mapped at its own slug on the next run. A keyless unlinked inbound
item is deferred (retried next run) only when its mapped hash equals that of an open create
the framework will still re-send; an item whose key matches no intent, or whose content
matches no such create, is provably not ours and maps normally. Creates that are never
re-sent never defer anything: write-back off, a provider that cannot deduplicate keys, or a
retired create. An open create whose pod resource is gone and whose key lookup misses is
retired as a manual conflict (counted in health). Use `ctx.sync.delete(id, version)` only for explicit tombstones,
and `ctx.sync.fail(id)` to record an adapter-side mapping failure for retry.

`ctx.sync.pendingRemoteIds()` lists identities the adapter must fetch even when a provider
delta omits them: echoes of our own writes, retained manual conflicts, and previously failed or
deferred inbound items. The runner verifies first echoes before advancing the checkpoint, so a
recovered version cannot hide later platform edits. Mapped resources are one item per document;
existing aggregate collection adapters need a separate item-layout migration. Their mapped
writes/removals may not bypass `ctx.sync` through `ctx.write`/`ctx.remove`. Unmapped companion
documents can use the ordinary import ports.

### Adopting a one-way import

The first two-way run of a connection (no adoption marker in the link-store manifest) performs
a full inbound pass **without** the delta cursor and links existing pod items at their
framework-owned slugs by remote id; a successful run then sets the marker and later runs resume
the cursor. Outbound never creates a resource that carries this connector's import provenance
(`prov:wasDerivedFrom` the connector source or `prov:wasGeneratedBy` a connector run Activity)
and has no link; such resources are reported as `unlinked-import`. Provider lanes converting an
existing import-only adapter must therefore write imports at the framework-owned slugs.

### Per-item failure isolation

An item whose mapping, hashing, pod read or write, or provider call fails is skipped with a
fixed reason class and the run continues: `mapping-failed`, `hash-failed`, `read-failed`,
`write-failed`, `remote-failed`, `weak-etag`, `duplicate-identity`, `link-cap`, plus the
non-failure classes `deferred`, `unlinked-import` and `unsupported-resource` (sub-containers
and members a listing types as non-RDF, which are never read). Health carries only these
classes, never provider text or tokens. Inbound skips are kept in the owner-only manifest
(at most 2,048 pending items) and returned by `pendingRemoteIds()`, so a cursor advance cannot
lose them. If the pending list would overflow, or an inbound failure has no valid remote id
(`ctx.sync.fail(undefined)`, an upsert without `remoteId`), the run keeps the previous cursor
instead, counts the failure and reports `cursorHeld: true`.
Abort, run-budget exhaustion (`RunBudgetExceededError`), rate limiting and 401/403
authorization failures still end the run. A weak ETag fails only its item.

### Conflicts, tombstones and moves

Provider timestamps must be server timestamps; pod timestamps come from `Last-Modified`.
Missing timestamps or differences of at most the default 120,000 ms skew guard preserve both
versions for manual resolution. The storage-client writer forwards `Last-Modified` only when
its backend exposes one on RDF reads; storage-client's `readRdf` does not today, so `lww` on
that writer falls back to `manual`. The fetch writer reads the header.

Manual conflicts are listed in `pendingRemoteIds()`. Switching the connection to `pod-wins`
or `remote-wins` resolves them on the next inbound replay or, when the provider omits the
item, in the outbound pass (pod-wins pushes the pod version under the conflict's remote
version; remote-wins restores the retained remote snapshot). Without write-back, a pod win
records the remote state as the baseline, so the item is not re-conflicted every run, and the
pod edit is pushed once write-back is enabled. Canonical content remains authoritative when a
provider's version or coarse `updated_at` timestamp does not advance. Concurrent
pod-delete/remote-edit disputes retain the remote snapshot for manual resolution.

Tombstones are durable: a remote restore of a trashed or pod-deleted item, or a pod resource
recreated at a tombstoned URL, becomes a manual conflict counted in health, never a silent
skip or an automatic recreate. A provider identity already linked to another pod resource
(for example a lagging lookup, or a cross-process race) never wedges the connection: that pod
resource keeps a conflict-only manual record naming the duplicate remote id.

Within one run, a newly listed unlinked resource is a move of a link whose pod resource just
vanished when its canonical hash equals that link's `lastSyncedHash`, or when its subjects or
PROV links (`prov:wasDerivedFrom`, `prov:wasRevisionOf`, ...) refer to that link's old
document URL or its fragments. The link is re-pointed (no remote create, no remote delete)
regardless of `propagateDeletes`. Canonical hashes are location-independent: the document URL
and its fragment IRIs hash relative to the document. A reference pairing first rebases
subjects copied verbatim with absolute IRIs onto the new URL (a conditional pod write), then
pushes an update to the provider. Only unambiguous one-to-one pairings move. A move writes the
new record first; an interrupted move is completed on the next load.

Safety net: a run that sees an `unlinked-import` arrival or an ambiguous move candidate cannot
tell a rename from a delete, so it propagates no pod deletes. Each vanished link is held as a
pending delete (counted in health). The next run decides: it moves, deletes (when enabled) or
keeps the warning if the ambiguity is gone, and a second consecutive held run
(`MAX_DELETE_HOLDS`) records a manual conflict with an empty pod-side snapshot instead.

### Link store

Links live in an owner-only store under `<account>/links/`: a manifest plus 64 base shards
placed by HMAC-SHA-256 (WebCrypto) keyed with a random per-connection salt held only in the
manifest, so remote ids cannot be ground into one shard. Each document holds at most 128
records; a full shard spills into overflow documents (`NN-1.ttl`, ...) recorded in the base
shard's header. A hard cap of 50,000 links per connection (`MAX_SYNC_LINKS`; `ports.maxLinks`
may lower it) skips and reports further items as `link-cap` instead of failing the run.
Trashed and pod-deleted tombstones are garbage-collected 30 days after deletion (unless they
carry an open manual conflict). Records use typed RDF accessors for remote identity/version,
pod URL/ETag, canonical baseline, durable create intent (with its rejection count), conflict,
deletion state, held-delete runs and time, and move markers.

The salt exists only in the manifest. If the manifest is missing while any base shard or
overflow document exists, `load()` refuses to mint a new salt (which would place every record
in the wrong shard) and the run fails with `LinkManifestLostError`. Recovery: restore
`<account>/links/manifest.ttl` from a backup, or delete the whole `<account>/links/`
container; the next run then re-adopts items with a full inbound pass, and pod resources that
carry import provenance but cannot be re-linked are reported as `unlinked-import`. A document 412 re-reads and merges unrelated record changes, with four
attempts; a concurrent change to the same record fails that item. Hosts must still serialize
runs across processes. Strong ETags are required on existing sync resources and link
documents. New documents are create-only. Sync resource reads use the import session's
metadata-preserving `readResource()` seam without retaining its precondition cache, so legacy
suite vocabulary aliases are normalized before canonical hashing and typed outbound access.

The link-store terms come from `CONNECTOR_SYNC` in `@jeswr/suite-vocab` (all under `NS.CORE`):
`ConnectorSyncLink`, `ConnectorSyncLinkShard`, `ConnectorSyncManifest` and
`ConnectorSyncPendingItem` classes; per-link `connectorPodUrl`, `connectorRemoteId`,
`connectorRemoteVersion`, `connectorPodEtag`, `connectorLastSyncedHash`,
`connectorNeedsInbound`, `connectorPendingCreate{Key,Hash,Etag,Resource,Attempts}`,
`connectorConflict{Resource,Version,RemoteId,Resolution}`, `connectorPendingDelete`,
`connectorDeleteHeldRuns`,
`connectorSyncStatus`, `connectorDeletedAt`, `connectorMovedFrom`, `connectorTrashUrl`; the
item link `connectorConflictSnapshot`; shard `connectorOverflowCount`; manifest
`connectorShardSalt` and `connectorAdoptedAt`; pending-item `connectorErrorClass` and
`connectorSyncDirection`. Snapshots also use `prov:wasRevisionOf` and `schema:expires`.

### Host ports

`SyncPodWriter` adds finite complete direct-child `list()` and `ensureOwnerOnly()` ports.
The fetch implementation reads listings through `@solid/object`, consumes advertised
`solid:etag` values, flags members typed `ldp:NonRDFSource`, and falls back to resource reads
when an ETag is missing. A listing entry is skipped as unchanged only when both its ETag and
the link's are known and equal. The fetch writer requires an advertised WAC ACL at the exact
resource URL plus `.acl`, then installs owner-only grants **before** link/snapshot bodies are
read or created; unsupported ACL discovery fails closed. Hosts with other permission systems
supply an equally strict protection port. Both owner protection and full listing completeness
are security contracts for custom hosts. The fetch implementation refuses partial responses
and advertised pagination; hosts needing paged containers supply a bounded complete listing
port. Pass the same signal to the writer and runner so every HTTP request within a port is
cancelled and checked, including the ACL PUT following its discovery HEAD.

### Writes, deletes and health

Creates persist their key and an immutable original payload snapshot before the remote call.
An interrupted create is recovered by key before inbound mapping, including when write-back
has since been disabled. Later pod edits remain detectable. Successful remote writes update
the link's remote version and exact submitted pod baseline, suppressing echoes without
absorbing a racing local edit. Remote deletes first copy into protected `<account>/trash/`,
mark a 30-day expiry and `prov:wasRevisionOf`, durably record the move, conditionally remove
the original, and leave a `trashed` tombstone. The expiry marker is for host cleanup; the
runner never silently purges trash. Interrupted trash moves remain counted as pending deletes
until removal completes. Pod deletions produce health warnings until propagation is
explicitly enabled.

Conflict losers live in protected `<account>/conflicts/`, carry `prov:wasRevisionOf`, and are
linked from the surviving item. `report.issues` exposes retained links with conflict snapshots
or pending deletes; `report.skippedItems` lists skipped items with their class (bounded to
1,000). `report.conflicts`, `pendingDeletes`, `failed`, `unlinkedImports`, `deferred`,
`moved` and `cursorHeld`, and the counts in `state.sync`, feed health pages. Manual conflicts block
outbound execution unless the policy resolves them. One PROV Activity describes each outbound
batch, alongside the existing import activity. Failed runs retain the prior checkpoint;
cancelled runs start no further I/O and retain durable intents for recovery.

One `RunBudget` covers Pod operations, remote operations and source transport requests;
source response bytes are charged as read (32 MiB per response). Documents are capped at
10,000 quads, 4 MiB of term text and 65,536 characters per term. Exact canonical mapped-field
hashes over the item's own subjects retain datatype, language and graph identity while
ignoring serialization, triple order, blank labels and the document's own URL. Nested RDF triple terms and other unsupported
term kinds are refused throughout the document, including outside the mapped projection.
Complex blank graphs fail closed: seven blank nodes, 100,000 quad visits and 32 MiB of
canonical comparison text are the limits. `maxResources` may lower the 50,000-entry scan
bound. Finite injected notification hints are bounded and validated, and force current
resource reads even when a listing's ETag lags an edit. They never replace complete scans;
hosts own subscription lifecycle and missed-event recovery. Companion binary writes share the
request/byte budgets; mapped item documents must use the RDF sync ports.

### Conformance

Later provider tests call `await twoWayConformanceSuite(makeAdapter)` from `./testing` with
the documented `TwoWayConformanceFixture` controls (including `seedOneWayImport`) over
recorded/synthetic transports. It checks import/update, crash recovery, a create retry with
the key lookup forced to miss, stale-`ifMatch` update and delete rejection, echo suppression,
all conflict policies, skew, delete opt-in, remote deletion leaving a trash snapshot and
tombstone, and the one-way-import adoption migration. `createFakeTwoWayAdapter(account,
{ delta?, deduplicatesCreateKeys? })`, `createMemorySyncPod()` and `fakeOneWayImport()`
provide the reference implementation; the package runs the suite over the full-listing,
delta-only and non-deduplicating variants. Targeted framework tests exercise validators,
bounds, abort, shard races and hostile inputs. No production provider APIs are used.

## Binary resources

Adapters store non-RDF resources (original files, `.eml` sources, attachments) with
`ctx.writeBinary({ slug, contentType, body, mode })`. The fetch-backed writer confines them to
the connector container exactly like RDF writes and refuses RDF media types (those go through
`ctx.write` so N3 serialises them and provenance is attached). `mode: 'create'` (default) sends
`If-None-Match: *` and reports an existing resource as `created: false`; `mode: 'replace'`
reads the current ETag and sends `If-Match`, refusing resources without a strong ETag. Hosts
whose `PodWriter` has no `writeBinary` make the call fail with `IntegrationSyncError`.

## Mail (Gmail and the shared MailWriter)

`@jeswr/pod-connectors/mail` is the source of truth for the framework-free MAI-01
layout (`pathId`, `SYSTEM_FOLDERS`, account/message/eml/thread/folder/attachment slugs),
standard mail IRIs (`constants.ts`), the capped linear `htmlToText`/`htmlToTextResult` scanner,
and MIME address-group flattening (`mailtos`). The suite
Mail model consumes these primitives while retaining its URL validation, typed RDF
wrappers, store, operations, importer and Type Index handling. The older standalone
pod-mail app consumes only identical IRIs; its account-free, percent-encoded paths stay local.
The public `./mail` entry loads neither `core/` nor `node/`; writer collision checks load
the existing provenance wrapper lazily when needed. `./mail/constants`, `./mail/paths`,
`./mail/html-text` and `./mail/addresses` can also be imported independently.

`documentSlug` and `systemFolderSlug` are relative to an account root;
`accountRoot`, `messageSlug`, `emlSlug`, `threadSlug`, `folderSlug`, `attachmentPath` and
`attachmentSlug` are relative to the storage or connector root. The raw layout helpers
`documentSlug`, `systemFolderSlug` and `attachmentPath` leave validation to their caller.
The connector helpers keep rejecting blank/dot account or document keys; the suite keeps
its looser legacy document/attachment validation and explicit system-key spelling.
`folderSlug` maps exact system titles such as `Inbox` to `system:inbox`; a generic
`documentSlug("folders", "Inbox")` remains a custom document.

Only address conversion is shared from MIME handling: the entire address is encoded in
`mailto:` (including `@`), exactly as both existing mail importers did. The suite's permissive
Message-ID/References handling and invalid-date errors stay local; connectors retain strict
single-token IDs, a 64 KiB References limit and omission of invalid dates. The linear HTML
scanner replaces the suite's regex fallback: it drops unfinished tags/comments
and unclosed script/style/head bodies, and decodes uppercase named entities. These edge
cases differ from the old regex fallback; normal mail output and all stored IRIs stay compatible.
HTML is still inert data and must be sanitised before rendering.

`htmlToTextResult(html)` returns `{ text, truncated }`; `htmlToText(html)` returns only
the text for compatibility. Tag and keyword matching folds ASCII letters only, preserving
Unicode offsets and contents. The scanner visits at most `MAX_HTML_INPUT_CHARS = 8,388,608`
UTF-16 code units of input (an 8 Mi-code-unit window, not a byte limit), then normalizes
whitespace and caps visible text at `MAX_HTML_CHARS = 1,048,576` UTF-16 code units without
splitting surrogate pairs. Work and intermediate storage remain linear in the bounded
input window. Comments, skipped blocks and collapsed whitespace do not consume the visible
text allowance. Exceeding either bound sets `truncated`; an input exactly at a bound is
complete if no text is omitted. Malformed markup keeps the omission behavior above.
When storing an HTML-derived body, MailWriter and Suite append the exported
`HTML_TEXT_TRUNCATION_NOTICE` on its own paragraph if truncated:
`[Message text truncated. The full HTML and the original message are kept with this email.]`
Full HTML and RFC 822 bytes are retained. Suite's `parseEmail`/`importMbox` per-message results
also expose `bodyTruncated: true`. Plain MIME text still takes precedence and receives no notice.

`./adapters/gmail` imports a mailbox through the Gmail API: a full sync lists every message
(`format=raw`), later runs replay `users.history.list` from the persisted `historyId` (an expired
id, HTTP 404, falls back to a full sync). Messages land in the pod-mail layout used by the Mail app
(apps MAI-01), inside the connector container: `mail/<account>/messages/gmail-<messageId>.ttl` with the
RFC 822 source beside it as `.eml`, `threads/gmail-<threadId>.ttl`, `folders/system:inbox.ttl` etc.
for system labels and `folders/<label>.ttl` for user labels, attachments under
`mail/attachments/<account>/`. Messages without INBOX, SENT, DRAFT or TRASH go to Archive; UNREAD
clears `schema:dateRead`; SPAM and deleted messages are removed together with their source and
attachments. `schema:EmailMessage` is registered for the account root (`registrationContainer`).

Gmail uses its opaque message id (1–256 ASCII letters, digits, `_` or `-`) for every document,
source and attachment path, and its thread id for conversations. Invalid ids are skipped.
Message-ID remains message metadata. In-Reply-To links use actual document ids from messages
added during the run or Gmail thread metadata (fetched at most once per thread per run);
unresolved parents are omitted. History deletions resolve
the message path directly; full syncs sweep vanished Gmail messages by listing `messages/`.
No separate source index is stored. A `format=raw` answer larger than the message cap (base64 of
`MAX_RAW_BYTES` plus framing) is skipped without reading its body, and any stored copy is kept.

`./mail` exports `createMailWriter(ctx, account)`, shared with the Takeout mbox path: `add()` stores
one raw message, then `flush()` writes accumulated thread and folder membership once per run.
File imports retain Message-ID document keys with collision fallback and References/In-Reply-To
thread ancestry. An explicit `documentId` bypasses Message-ID keying; `resolveParent(messageId)`
can supply the parent's document id. Without an explicit document id, unresolved replies keep
the Message-ID-derived link used by file imports. Additions commit RDF before
bytes and collections; thread moves remove the old membership conditionally before replacing RDF.
`removeMessage()` queues deletions in batches of 100, with the remainder processed by `flush()`
before reconciliation, so a caller that only deletes must still call `flush()`. Each batch reads and conditionally updates each affected collection once,
then deletes attachments and `.eml`, and deletes each message's RDF last. Flush rereads the
collections it reconciles so each dataset uses the ETag from its own read. An interrupted deletion
retains its cleanup inventory in that RDF for replay; a missing document is a no-op. Attachment
media types from mail are untrusted: RDF and malformed types are stored as `application/octet-stream`.

## Transactional email markup (CON-A8)

`./mail` exports `extractEmailMarkup(html, { maxBytes?, maxItems? })`,
`extractEmailMarkupResult(html, options?)` (items, truncation flag and scalar-character count),
`createMailMarkupWriter(ctx, account, options?)` and `rescanMailMarkup(ctx, account, options?)`.
The pure extractor returns discriminated `EmailMarkupItem` values (`type`, `properties`), with
allowlisted schema.org properties containing arrays of inert scalars or nested `MarkupNode`s.
It supports Order (including OrderItem, Offer and ParcelDelivery), ParcelDelivery,
FlightReservation, TrainReservation, BusReservation, LodgingReservation,
FoodEstablishmentReservation, EventReservation and RentalCarReservation.

Extraction accepts JSON-LD scripts, arrays and `@graph`, plus nested microdata scopes.
Schema.org HTTP/HTTPS type IRIs and optional trailing slashes are normalized to mail's
`http://schema.org/` vocabulary when written. Compact JSON-LD terms use an implied schema.org
context; schema.org context strings and a single inline `@vocab` are accepted. Foreign or
redefining contexts are refused. Nothing is executed or fetched, including contexts, script
sources, tracking URLs and microdata `itemref`. This is a closed metadata reader, not a full
JSON-LD processor or browser HTML tree builder. Untyped nested property objects are retained;
unsupported explicitly typed objects and unknown properties are omitted. URLs remain literals.

The default whole-HTML UTF-8 cap is 1 MiB (configurable up to 8 MiB); an oversized email yields
no items. Default root item cap is 100 (hard ceiling 1,000). Further fixed caps are 32 script
blocks (including non-JSON scripts), 50,000 HTML elements, nesting depth 32, 4,096 normalized
nodes, 4,096 microdata scopes, 16,384 visited property values across the email, 64 values per
property, 64 attributes per tag, 16 KiB per tag,
8,192 UTF-16 units per scalar and 50,000 JSON separators per script. JSON depth/structural/string
guards run before `JSON.parse`. Malformed blocks are skipped, oversized scalar values omitted,
and unfinished microdata scopes discarded. Tokenization scans forward through the bounded
input and skips comments and raw script/style/textarea bodies without parsing their HTML.

`createMailWriter(ctx, account, { extractMarkup: false })` disables automatic extraction;
the default is on after the message RDF and bytes have been stored. The source factories
`createGmailAdapter(options)` and `createGoogleTakeoutFileAdapter(options)` accept the same
`MailWriterOptions` (`extractMarkup`, and `markup: { maxBytes, maxItems, maxTotalItems,
maxUnverifiedItems, maxTotalWrites, maxUnverifiedWrites }`). Scalar extraction across an email is capped at 256 Ki UTF-16 characters;
completed microdata values also have an independent intermediate budget of that size, before
normalization can duplicate nested aliases. Extraction stops at exhaustion, retains values
that fit, and flags `truncated`. Source message IRIs are capped at 8,192 characters before repeated provenance allocation.
Each item is capped at 256 RDF nodes (`MAX_MARKUP_ITEM_NODES`, root plus nested resources)
and its UTF-8 Turtle at 64 KiB. The writer keeps a running size estimate while building an
item and abandons it as soon as either cap is exceeded, before serializing; the exact
serialized size is then checked before writing and again after session provenance/vocabulary
mapping. Oversized items are skipped with `markup-item-too-large`.
Depth overflow suppresses further microdata frames while still finding later JSON-LD scripts.
A writer shares item and PUT-attempt budgets across messages. Only items accepted for
writing count against the item budget; skipped, stale and rejected items do not. Verified
mail has its own allowance (`maxTotalItems`, 2,000 by default) and keeps the per-message cap
(`maxItems`, default 100). Unverified mail is capped at 10 root items per message
(`MAX_UNVERIFIED_MARKUP_ITEMS_PER_MESSAGE`) and a separate `maxUnverifiedItems` allowance
(500 by default, never above `maxTotalItems`), so unverified senders cannot starve later
verified mail. PUT attempts (`maxTotalWrites`, 2,000 by default) include source
cleanup-inventory updates and failed attempts. Unverified mail's inventory and item PUTs also
draw on `maxUnverifiedWrites` (500 by default, never above `maxTotalWrites`), so verified mail
always keeps the rest of the PUT budget. Hard ceilings are 100,000. Every item of a message is
decided and size-checked before any PUT, so rejected, stale, blocked and oversized items cost
no PUT. Accepted items are trimmed to the remaining item allowance and to the PUTs left for
their trust level (counting the inventory PUT when it is needed); trimmed items are reported
with the budget error codes. `MailMarkupWriter.exhausted` is true once neither verified nor
unverified mail can write another item, because each has spent its item or PUT allowance.
Re-scan uses the same budgets. Failures skip that message's remaining markup and leave its
email and mailbox import running; cancellation still aborts. `MailWriter.errors`,
`MailMarkupWriter.errors`, re-scan results and `ImportReport.errors` expose distinct stable
codes, without exception text: `markup-extraction-failed`, `markup-write-failed`,
`markup-truncated`, `markup-item-too-large`, `markup-item-budget-exceeded`,
`markup-write-budget-exceeded` and `markup-source-missing`. Imports can therefore advance their cursor with these
recoverable markup errors; re-scan can repair partial writes later.

The writer stores schema.org resources under `mail/<account>/purchases/` (orders/deliveries)
and `mail/<account>/trips/` (reservations), registering their classes there. SHA-256 identities
use `[type, senderKey, provider, number]` (tracking number for deliveries), otherwise message
IRI + extraction index. Provider identity prefers URL, identifier, then name; names fold
ASCII case/whitespace, while URL paths and identifiers retain case. Sender keys are the
aligned DMARC domain for verified messages and the lowercased From domain otherwise.
Missing/invalid From uses the source message IRI, preventing cross-message collisions.
Every nested resource records `prov:wasDerivedFrom`, `fedcon:emailMarkupSenderKey` and
`fedcon:emailMarkupTrust`. Verified assertions can update either trust level at the same
identity; unverified assertions can update only unverified resources. Older receiver times
are rejected; verified evidence may promote an unverified assertion regardless of its old time.

Gmail raw and Takeout mbox imports accept Google's `Authentication-Results` only by position.
The receiver walks the header block top-down. Every `Received` header above the assertion must
be a Google hop: `by <host>.google.com` with `SMTP`, `ESMTP`, `ESMTPS`, `SMTPS`, `UTF8SMTP` or
`UTF8SMTPS`, or Google's internal `by <IP literal> with SMTP id` form. Authenticated
submission (`ESMTPA`, `ESMTPSA`, `UTF8SMTPA`) marks where client-written headers enter, and
`LMTP` appears in no genuine Google layout, so neither is accepted. The last hop must be the
inbound MX receipt, `Received: from ... by mx.google.com with ESMTP|ESMTPS|SMTPS|UTF8SMTP|UTF8SMTPS`
(UTF8 forms carry internationalized mail), and the first assertion with
authserv-id `mx.google.com` must follow it with no other `Received` in between. A non-Google
hop, a Google POP3/IMAP/HTTP receipt (mail fetch, IMAP append, API insertion), an unparseable
trace, or an assertion above the receipt leaves the message unverified. This covers
migrated or appended mail that carries a sender-forged `mx.google.com` assertion without
Google's own. Later duplicate headers and all other authserv-ids are ignored. A message
appended with no Google trace at all whose sender wrote a complete Google-shaped block on top
is indistinguishable from received mail. Result clauses are split per RFC 8601 after CFWS
tokenization, so semicolons inside quoted strings or comments cannot start a clause. An
ambiguous header fails closed: a `"` inside a comment, or `(`, `)` or `;` inside a quoted
string (for example a quoted MAIL FROM local part echoed in Google's spf comment). The same
tokenization applies to `Received` headers. A single
`dmarc=pass` clause, with an optional `reason` and `ptype.property=value` properties only,
must include one unquoted aligned `header.from` domain matching the From domain exactly or
containing it as a subdomain. Missing, mismatched, ambiguous or
failed evidence stays unverified. Unsupported syntax in that first Google header also stays
unverified and never authorizes a later duplicate. The host can still supply trusted receiver evidence through
`MailItem.authentication`, `MailMarkupSource.authentication` or the re-scan lookup, including
`alignedDomain`; the existing explicitly aligned SPF+DKIM host evidence is also accepted.
Verified means only that Google reported DMARC alignment for the From domain: any sender
whose own domain passes DMARC counts as verified for that domain, including a domain an
attacker registered. It verifies sender authentication, not the truth of a booking; the
sender key keeps each domain's assertions apart. Message RDF retains the
sender key, trust and receiver modification time for later HTML-only re-scans.

`schema:dateModified` uses only receiver time: Gmail `internalDate`; Takeout's mbox `From `
separator timestamp, which Google writes (zone-less separator times are interpreted as UTC),
falling back only when the separator has no valid date to Google's inbound MX receipt under
the positional rule above. Future receiver times are clamped to
import time. Missing time is omitted and compares as epoch; neither MIME `Date` nor markup
modification times can pin a record. Re-scan uses only the dedicated receiver modification
time persisted by the writer; legacy sent/received fields are not treated as trusted evidence.

The source message's `fedcon:emailMarkupSlug` literals index accepted markup resources only.
The inventory is committed once before item PUTs, is skipped entirely when no item is
accepted, and is preserved on replay. Removal checks each
indexed resource's current derivation before deleting it, so removing an earlier email keeps
a newer booking update. Gmail 404, SPAM and full-sync sweep deletions use this cleanup;
moving a message to Trash retires its markup while retaining the message in the Trash folder.
Cleanup works even when extraction is opted out. Direct markup-writer callers supply `MailMarkupSource.sender` as the From mailbox (plain
address or `mailto:`) and store the source EmailMessage first so its cleanup inventory can be
persisted. If the source message read returns nothing, every item write for that message is
skipped with `markup-source-missing`, so no item lacks a cleanup index.
`removeMailMarkupResources(ctx, account, messageIri, slugs)` exposes the same
guarded cleanup for hosts. `MailItem.trashed` retires markup while keeping the source message;
its Trash folder membership also prevents re-scan from recreating assertions.

Re-scan reads only stored `schema:EmailMessage` HTML from the account's messages listing;
`maxMessages` bounds visited entries (10,000 default, 100,000 hard ceiling). It returns
`{ messages, items, errors? }`. `maxTotalItems` defaults to 2,000 (100,000 hard ceiling).
Re-scan stops early once the writer's budgets are exhausted.
`prune: true` additionally checks purchases/trips resources, removes those whose sole current
source message no longer exists, and returns `pruned`. Each run checks at most
`maxPruneItems` resources (2,000 by default, 100,000 hard ceiling; separate from the item
budget) in slug order after a continuation cursor. The cursor is persisted in
`markupStateSlug(account)` (`mail/<account>/markup-state.ttl`, `fedcon:emailMarkupPruneCursor`),
which inherits the mail account's owner-only access and is never registered in a type index.
A capped run advances the cursor; a run that reaches the end clears it, so successive runs
page through every resource and then start again. A malformed cursor restarts from the
beginning. Pruning requires
`ctx.remove`; external, malformed or ambiguous source links are retained. Supply serialized
import-session ports to preserve ETags, provenance, cancellation and registration.
`ctx.releaseRead(slug)` releases read-only datasets/preconditions; runners provide it and
custom ports that cache reads must implement it. Re-scan requires no provider API access.
`NormalisedDoc.maxSerializedBytes` optionally applies a post-provenance UTF-8 Turtle cap, including the Pod writer's vocabulary prefixes, in
the shared session; markup writes set it to 64 KiB.

## Google Takeout

`./adapters/google-takeout` accepts the downloaded `.zip` directly, plus legacy single
`MyActivity.json` files. ZIP detection uses the `PK\x03\x04` signature. Archive imports
require `ImportFile.stream()` for signature detection and a reopenable ranged-read port,
`slice(start, end): { stream(): ReadableStream<Uint8Array> }`, with an exclusive end (native
File/Blob and the Node CLI provide both). ZIP input never goes through `text()` and has
no whole-file fallback. The mailbox account comes only from the first message's header
block in the first valid mbox entry (at most 64 KiB); absent a valid Delivered-To address,
it is `google-takeout`. No full archive preflight pass is needed.

The reader locates the central directory, including ZIP64 records/extra fields and offsets
above 4 GiB, with a 64 MiB directory cap and 100,000-entry ceiling. Archive-wide structural
errors, ceiling violations and multi-disk ZIPs fail before dispatch. Every local name,
method, flag and data range is validated before import; overlapping and duplicate entries
are skipped. Descriptor signatures inside file contents cannot create entries. Entry
sizes come from the directory. Pinned fflate 0.8.3 `Inflate` receives at most 64 KiB per
piece, awaiting downstream work between pieces. Its pinned completion/pending state is
checked after each push; early DEFLATE completion, incomplete streams, size mismatches and
CRC-32 mismatches skip the entry.
Decoder exceptions abort the archive, including during mailbox-header sniffing, because
fflate may throw after producing internal output without reporting its byte count.
Whole-file JSON/CSV/ICS/vCard handlers retain at most 64 MiB, each mail message at most
Gmail's 36 MiB, and each Drive copy at most 25 MiB. The run caps inflated data at 16 GiB
and entries at 100,000. Every emitted byte counts, including mailbox-header sniffing and
output rejected by later entry checks;
exceeding the actual-byte budget stops the archive before snapshot reconciliation. Each rejected
entry/message counts in `report.skipped`. Oversized Drive files keep metadata with
`contentSkipped`, remove stale copied content and also count as skipped. Names are untrusted:
path segments are escaped with mail `pathId`, with traversal/empty/absolute paths and depth
above 16 rejected. Encrypted entries and unsupported compression methods are skipped and
reported. URLs inside exports are never fetched.

Dispatch supports mail `.mbox` (shared MailWriter, Gmail labels/read flags and decimal-to-hex
thread ids), calendar `.ics` (shared Calendar mapping/recurrence), contacts `.vcf` (shared
People mapping and SolidOS address-book index), owned files below `Drive/`, YouTube watch
history and `My Activity/**/MyActivity.json`, Semantic Location History place visits, and Fit
daily CSV metrics. Fit retains the Apple Health/Fitbit `schema:ExerciseAction` daily-activity
model with typed steps, distance, calories, heart-point and move-minute measurements. Raw
`Records.json` points are unsupported. Unknown entries are grouped by product in
`report.unsupported`; `archive_browser.html` and directory entries are ignored.

Drive binaries live at `drive/takeout/<escaped path>` and metadata in the separate
`drive/takeout-meta/<escaped path>.ttl` tree to avoid collisions with source filenames.
Calendar, activity, location and Fit documents have deterministic paths per export entry;
a later complete product snapshot replaces them, including removed optional fields.
Any skipped/capped/corrupt/unparseable entry makes its product incomplete: successful
entries only add/update records and preserve previous membership. Archive-wide inflation
limits suppress destructive reconciliation for every product. Deferred snapshot and contacts
reconciliation share a budget of 1,000,000 retained identifiers and 64 MiB of UTF-8 identifier
text (contact display names also count). A product that would exceed it reports
`reconciliation-state-cap-exceeded`, releases its retained identifiers and continues with
adds/updates only; other products can still reconcile. Calendar entries require balanced
`VCALENDAR > VEVENT` components; other components are skipped as balanced blocks. vCards
cannot nest. Missing or mismatched END markers make the whole entry incomplete.
Complete empty activity
snapshots remove their category documents after reading the ETag, and clearing alone is
a successful import. Contacts replace membership and delete stale indexed people only
when every contacts entry succeeded; malformed nonempty vCards preserve membership. Mail reuses
Gmail's shared message/thread/folder writer and its membership reconciliation.
Location rows require a visit with a usable location (name, address, place id, or a valid
coordinate pair) and valid duration, or an
`activitySegment` object. Malformed visits and unknown row shapes count as skipped and
preserve previous location membership. Contact rows, including duplicate cards, share
one run-level ceiling across entries, even after reconciliation manifests are released;
excess contacts are skipped before any contact or membership writes.

File adapters receive `ctx.read(slug)` through the same import-session port as API adapters,
including ETag retention. `importFile` may return `{ skipped?, unsupported? }`; both appear on
`ImportReport`, and skipped counts enter connector state. Existing void-returning adapters
keep working. An unsupported-only archive returns its report even when it writes no documents.
Only adapters declaring `streaming: true` bypass the runner's 64 MiB whole-upload size check;
they must enforce their own streaming limits. Legacy Takeout JSON still has the 64 MiB cap.

## WHOOP

`./adapters/whoop` exports `whoopAdapter`, `createWhoopAdapter(limits?)`,
`whoopFileAdapter`, `createWhoopFileAdapter(maxRecords?)` and `pendingWhoopBatch(cursor)`. Both paths appear under **one**
health catalogue id, `whoop`, like Garmin.
Hosts inject `createRegistry({ whoop: { clientId, tokenProxyUrl } })` and a separate
`SourceAuth`. Code exchange defaults to the shared confidential-client token proxy;
a Node host may instead inject its client secret for direct exchange. Client id alone
keeps the connector in demo mode. Public secretless exchange is not assumed.
The Tier A OAuth path uses the shared authorization-code/S256 PKCE engine with WHOOP's
`/oauth/oauth2/auth` and `/oauth/oauth2/token` endpoints. Scopes are `read:recovery`,
`read:cycles`, `read:sleep` and `read:workout`. Tokens remain host-owned and in memory.
Automatic refresh is not implemented, so `offline` (a refresh token) is not requested.
Provider behavior is exercised with synthetic v2-shaped fixtures only, without live
verification of client registration or token exchange.

The file path accepts `my_whoop_data_<date>.zip` from WHOOP → More → App Settings →
Data Export, or a single `physiological_cycles.csv`, `sleeps.csv` or `workouts.csv`.
ZIPs use Takeout's streaming, ranged central-directory/CRC/DEFLATE reader; native File/Blob
or equivalent `stream()` and `slice()` ports are required, with no whole-archive fallback.
Header matching ignores case, punctuation and whitespace and rejects normalization collisions.
CSV timestamps require an explicit offset, either in the timestamp or the export's
Cycle/Sleep/Workout timezone column. Ambiguous local times are skipped instead of assuming
UTC or the host timezone. Journal entries and unknown archive products are reported as unsupported.

API v2 collections are `cycle`, `recovery`, `activity/sleep` and `activity/workout`.
Each drains `next_token` (also accepting `nextToken` in fixtures) through the `nextToken`
query parameter. Tokens are opaque, URL-encoded, capped and checked for cycles. Collection
envelopes fail closed; malformed individual records are skipped. Recoveries join their
cycle id to a cycle start time; no time is fabricated for an unmatched recovery.
Only scored records are imported. After traversal completes, the ISO cursor is the newest
imported start time. A batch stopped by the item or request budget saves an opaque cursor
with its collection, page token, row offset, original start filter and high-water time.
Pass `report.cursor` (or `report.state`) into the next run until traversal completes;
the high-water timestamp alone would skip older pages. A resumed page that now has fewer
rows than the saved offset is replayed from its first row. If WHOOP rejects or has expired
the saved page token (HTTP 400/404), that collection restarts once per run from the saved
start without a token; records are keyed by kind and native id, so the replay is idempotent.
A completed traversal that imported no scored record returns the distinct
`{"v":1,"complete":true}` cursor (never no cursor, which would leave a stale batch cursor in
place); the next run treats it, like a `{"file":…}` cursor from a host sharing one checkpoint
between paths, as a fresh traversal. Each pending batch cursor records `base`, the completed
high-water cursor its traversal started from. `pendingWhoopBatch(cursor)` returns `{ base? }`
for a pending batch: Suite passes pending batches through on a partial scope selection (the
adapter reads only `ctx.scopes`), so batches advance, and restores `base` on completion so a
withheld collection's checkpoint never advances. Resumed recoveries resolve missing
cycle dates through the [documented `cycle/<id>` endpoint](https://developer.whoop.com/api/);
absent cycles are skipped, never assigned invented dates.
With `ctx.scopes`, only granted collections are requested; recovery also requires cycles
to resolve its timestamp. Withheld collections leave their stored records untouched.
Subsequent requests use `start` with a seven-day overlap to replay delayed scores/updates.
WHOOP's start filter is not an updated-since feed: changes to older events, or previously
unmatched recoveries outside that overlap, require a cursor-free import. Full and incremental
imports both preserve unrelated historical records; source deletions are not inferred.

The destination layout is `health/observations/YYYY-MM.ttl` plus `health/workouts/YYYY-MM.ttl`,
inside the WHOOP connector container. The Type Index registers health:Observation against
`health/observations/`, and both schema:ExerciseAction and health:Observation (each workout's
energy and heart-rate observations) against `health/workouts/`, so readers can discover all
monthly documents. Observations are written and validated by the generated
`@jeswr/solid-health` model (`buildObservation`), like Garmin; `src/whoop/model.ts` keeps
only the WHOOP mapping policy (field → name, code, UCUM unit, optional QUDT unit, subtype).
Observation values, CodeableConcepts, OWL-Time instants, UCUM codes and local person
subjects follow the Health app's Apple Health model. Resting HR and total asleep duration use its existing HeartRateObservation/SleepObservation
classes and LOINC codes (resting heart rate **40443-4**, asleep duration **93832-4**). HRV
retains **RMSSD** (never relabelled as Apple's SDNN), skin
temperature, SpO2, respiratory rate, energy and reported light/deep/REM durations use generic
health:Observation with literal source field codes and no invented `inScheme`. Sleep stages
remain separate reported totals, with no invented stage chronology and no SleepObservation
subtype that would double-count the total. API kilojoules and CSV dietary calories normalize
to kJ; workouts also carry schema:ExerciseAction energy/duration/name like Garmin.

<!-- AUTHORED-BY Claude Opus 5.5 -->
Output changes from the move to `@jeswr/solid-health` (each pinned in `whoop.test.ts`):

- `health:value` is `xsd:decimal` instead of `xsd:double`.
- Observations are also typed `health:ClinicalEntry`; instants also `time:TemporalEntity`.
- Code and instant helpers are `<observation>-code` / `<observation>-time` instead of
  `<observation>/code` / `<observation>/time`. Reimporting a record removes legacy helpers.
- The profile's QUDT inventory is NUM, M, SEC and BEAT-PER-MIN. HRV (`ms`), skin
  temperature (`Cel`), SpO2 (`%`), energy (`kJ`) and respiratory rate (`/min`) now carry
  only their UCUM `health:unitCode`; the former `unit:MilliSEC`, `unit:DEG_C`,
  `unit:PERCENT`, `unit:KiloJ` and `unit:PER-MIN` links are no longer written.
- Observations no longer carry `schema:endTime`: the profile's effective time is a single
  instant (the record start). The record's `schema:Dataset` marker keeps its end time.

Observation and record IDs, document paths, codes, schemes, names, `dct:source`, the API
`schema:url` used for provenance, CSV/API deduplication and the workout ExerciseAction
are unchanged. Strict `parseObservations` reads reject observations stored by an earlier
version (`xsd:double`) until their record is reimported.

The connector's Apple Health adapter currently imports only workouts; the Health app's
observation reader currently charts six metric kinds. Total sleep uses that reader's class,
code and unit; resting HR retains its distinct
40443-4 concept, which the current heart-rate chart (8867-4) does not include. Other WHOOP
values are retained as canonical observations for readers supporting those codes. Hosts must
route/discover the WHOOP container;
this change does not add metric cards or change the Health app's fixed storage root.
The health sector has no recovery score, strain or sleep performance terms. These scores
are omitted and listed in `report.unsupported` for both paths; no new vocabulary IRIs are minted.

API fragments use native WHOOP ids; CSV fragments use `(start instant, record kind)`.
Matching compares UTC start times at whole-second precision with an inclusive ±60 second
tolerance and the same record kind, including adjacent monthly shards. An API record removes
matching CSV descriptions and deterministic helper nodes. CSV records never replace a matching
API record. Duplicate rows and reimports are idempotent. Distinct native ids at the same instant remain distinct.
Monthly shards are selected by UTC start; a provider correction moving an event to another
month outside the CSV matching tolerance cannot remove its old shard copy without a separate
reconciliation inventory.
All writes use retained ETags and the shared bounded provenance pipeline.

WHOOP limits are 64 MiB per upload, 16 MiB per archive CSV, 100 ZIP entries, 10,000
processed source rows per batch and 10,000 normalized records (a physiological row may yield
two). Every monthly shard stays within `@jeswr/solid-health`'s reader limits
(`MAX_OBSERVATION_QUADS`, 100,000 quads, and `MAX_OBSERVATIONS`, 5,000 observations),
counting the provenance links the import session adds: a run that would write a larger shard
fails before writing that shard, and a stored shard above the limit is refused. Byte-bounded CSV contents are scanned for sort
keys; a bounded heap selects the newest rows first, then they are parsed and written in
monthly groups. The file path saves a SHA-256 content-bound cursor in `report.cursor` and
`report.state`; pass either to the next `runFileImport` with the same export. Re-selecting it
in Suite resumes automatically. A finished traversal returns a distinct completion cursor;
importing the same export again then starts a fresh traversal from its newest rows, so a
re-import restores removed shards (rewrites are idempotent). The Node CLI keeps file and API
progress in separate `fileCursor` and `cursor` slots of `state.json`, so neither path
overwrites or misreads the other's checkpoint; an older single shared cursor is classified by
shape on read. It resumes pending WHOOP batches on ordinary reruns and prints their warning;
a completed API traversal retains the normal `--since` behavior. Duplicate and malformed rows consume the batch's row budget; malformed source records found
while scanning sort keys are counted as skipped once per traversal, not once per batch;
physiological rows stay atomic when only one record slot remains. A changed export restarts
from its newest rows. Both API and file reports include a **“WHOOP import partial, re-run to
continue.”** warning when another batch remains. `createWhoopFileAdapter(maxRecords)` accepts
a smaller record budget (minimum 2). CSV sleep stages allow up to three minutes of rounding
overage over the asleep total, while still requiring stages and total to fit the interval.
Default API limits are 2,000 requests, 10,000 source items and 64 MiB cumulative JSON bytes; `createWhoopAdapter(limits)` accepts tighter host
budgets. The shared 32 MiB JSON response and 4 MiB logical CSV record limits also apply.
Source input is staged before data writes; invalid pages, CRCs, byte/quad limits, HTTP 401/429 and
cancellation never advance the checkpoint. 429 is surfaced for host scheduling without
retrying. Synthetic tests cover both orders of CSV/API deduplication, pagination, hostile
headers/archives/records, budgets, provenance and cancellation. No new dependencies.

## Garmin account export

The existing `garmin` file adapter accepts the **full account ZIP**, recommended from
[Garmin Account → Data Management → Export Your Data](https://www.garmin.com/account/datamanagement/).
Select the downloaded ZIP directly. Activities CSV, GPX and TCX remain supported under
the same catalog id. No Garmin API credentials or Garmin network requests are needed.
Entries identify the export regardless of its filename. ZIPs require Takeout's `stream()`
and reopenable `slice()` ports.

Supported paths tolerate account/email/UserID prefixes and filename date suffixes:

- `DI_CONNECT/DI-Connect-Fitness/*summarizedActivities*.json`: flat arrays, object-wrapped
  arrays or `[{ summarizedActivitiesExport: [...] }]`. Activity IDs become
  `health/activities.ttl#activity-<id>` or `mobility/journeys.ttl#journey-<id>`.
  Runs/indoor cycling are exercise actions; outdoor rides/commutes are travel actions.
  Archive distance/elevation are converted from cm to m, duration from ms to s and
  ISO duration text. Summary `calories` appear to use kJ-like units: divide by 4.184
  and round to one decimal place for kcal. **This conversion is pending verification
  against a real export.** Pulse/elevation summaries are labelled notes.
- `DI_CONNECT/DI-Connect-Aggregator/UDSFile_*.json`: steps, distance, resting/minimum/
  maximum/average pulse, active kcal and floors. Numeric strings and zero counts work;
  invalid dates and non-finite/negative values are omitted.
- Wellness `*sleepData*.json`: asleep seconds (deep + light + REM, excluding awake time).
  The source window, stages, awake seconds and overall score remain labelled notes.
  Time in bed alone never becomes asleep time.
- Wellness `*healthStatusData*`/`*hrv*` and Metrics `*MetricsMaxMetData*`: recognizable
  overnight HRV summaries in ms and running/cycling VO₂max in mL/(kg.min).

Daily measurements use `health/observations/<metric>/<YYYY-MM>.ttl`, deterministic
metric/day subjects, and existing HealthRecord/Observation/CodeableConcept/OWL-Time terms.
Steps, pulse and sleep use the Health model's QUDT/UCUM units; other quantities use generic
observations and source field codes without asserting a concept scheme; running and cycling
VO₂max have distinct codes. The patient is an unnamed document-local `#subject`, following
Apple Health; an export does not establish the Pod owner's identity. Effective instants use
the calendar date (UTC midnight), following Health's current measurement reader. If only a
timestamp is available, its own offset determines the day. Numeric epochs must be Garmin
milliseconds between 2000-01-01 and now + one day; seconds, zero and date-like numbers are
rejected. Reimports merge matching subjects under ETags; overlapping exports preserve older
dates. File imports have no cursor
or deletion reconciliation. Raw JSON files are not retained.

The connector Apple Health adapter currently imports workouts only. The suite Health
model's separate Apple importer supplies the observation mapping used here. **Health charts
currently read native monthly shards rather than connector metric directories**, and have no
separate HRV/VO₂max charts. Observations are stored and registered using existing health
terms; automatic chart discovery needs follow-up app work. This change includes no app edits.

Stress, Body Battery and intensity minutes have no terms in the current health sector.
They produce vocabulary-gap notes in `report.unsupported`, counted once per file per gap,
with the number of distinct affected days per file. These notes do not increment
`report.skipped`. Unknown files and directories are counted as unrecognised in notes;
malformed/oversized records and omitted supported entries increment `report.skipped`.
Grouped notes retain no account paths. Uploaded-Files nested ZIPs are counted without opening
them; their note directs users to the `activity-files` adapter for FIT import. Unknown record
shapes are reported, not guessed.

Garmin reuses Takeout's ZIP/ZIP64 directory, local-header, overlap, size and CRC validation.
Defaults: 10,000 dispatched entries, 64 MiB decompressed per entry, 32 MiB JSON per entry,
512 MiB actual inflation per run, 100,000 records per file, 1,000,000 attempted records
per run (including malformed/oversized rows), 100,000 observations/activities
per run (including duplicates), and a declared compression-ratio ceiling of 1,000:1.
The reader independently rejects directories above 64 MiB or 100,000 entries. Shared JSON
limits are 1 MiB per token, 4 MiB per record and 64 nesting levels. Entry bytes are bounded
and CRC-verified before JSON dispatch; wrapper arrays are parsed record by record. DEFLATE
receives 1 KiB pieces to bound transient expansion. Recognised entries are staged in memory
(within the caps above) and written once at the end; each monthly metric document has at most one value per day. Activities are retained under
the run cap and written once to avoid repeated collection growth. Cancellation is checked
between entries, inflater chunks, records and Pod operations. Corrupt entries are skipped;
decoder exceptions abort because their unreported work cannot be charged safely. Caps retain
successful records with warning notes. Rows parsed before a late JSON error in the same entry
are discarded and counted as skipped; no destructive reconciliation occurs.

`createGarminFileAdapter(partialLimits)` from `./adapters/garmin` can lower these limits;
`GARMIN_ARCHIVE_LIMITS` and `GarminArchiveLimits` expose the ceilings. Legacy text remains
capped at 64 MiB despite ZIP's `streaming: true`. Tests use only synthetic archives;
maintainer validation with real account exports remains necessary.

Maintenance constraints: read `src/garmin/archive.ts` and `health-vocab.ts`; reuse Takeout's
ZIP validation and `core/file-json.ts`. Never recurse into Uploaded-Files FIT ZIPs, fetch
source URLs or fall back to whole-archive text. Preserve the existing CSV/GPX/TCX units
policy and rides/indoor-cycling split. Use only existing sector terms, never invented
HRV/VO2max subclasses or IRIs. Catch entry parse failures separately from Pod writes;
writer failures and decoder exceptions must propagate. Keep cap/FIT skips separate from
unrecognised files, and preserve model limits for observations including duplicate rows.
The Apple connector is workouts-only; use the separate suite Health model's
Observation/CodeableConcept/Instant mapping for metrics. Do not claim automatic connector
chart discovery or HRV/VO2max charts without app support.
The range signature check leaves the full legacy stream for `fileText`, which enforces the
actual byte cap independently of the supplied file size.

## Bank statements

`./adapters/bank-statements` exports `bankStatementsFileAdapter` and
`createBankStatementsFileAdapter(options)`. CSV detection uses normalized headers,
never the filename: Revolut account statements, Monzo transaction exports and
Starling GBP statements. Revolut and Starling headers must match exactly after
normalization. Monzo exports differ by app version, so Monzo is detected by column
name in any order: Transaction ID, Date, Time, Type, Name, Amount and Currency are
required; Emoji, Category, Local amount + Local currency, Notes and #tags, Address,
Receipt, Description, Category split and Money Out + Money In are optional (each `+`
pair must appear together). This admits the short 11-column layout and the full
18-column layout (`…,Notes and #tags,Address,Receipt,Description,Category split,Money Out,Money In`).
Unknown or duplicate columns are not Monzo. A header containing two or more
distinctive columns of one bank is rejected with "looks like <bank> but the columns
differ" if it does not match: Revolut's Product, State, Started Date and Completed
Date; Monzo's Transaction ID, Emoji, Local amount, Notes and #tags and Category
split; Starling's Counter Party, Amount (GBP) and Spending Category. Known banks
take precedence over the original generic CSV importer. Other headers retain
that importer's date/description/amount aliases, separate debit/credit support,
lenient value/date parsing, row-index-derived IDs and snapshot replacement behavior.
Generic imports do not infer currency or create account links. An explicit
`csvFormat` disables this fallback; mismatches return a bounded `unsupported` report.
The export-screen directions in `fileHint` are guidance; no provider was contacted
to verify current menus. All tests use synthetic files.

HSBC UK's three-column **headerless** CSV is ambiguous. Hosts must explicitly
select it and supply a stable account label; the default picker adapter refuses it:

```ts
import { createBankStatementsFileAdapter } from '@jeswr/pod-connectors/adapters/bank-statements';

const adapter = createBankStatementsFileAdapter({
  csvFormat: 'hsbc-uk',
  accountLabel: 'HSBC everyday', // use a different label for a credit card
  currency: 'GBP', // HSBC UK default; validated against the runtime's ISO 4217 codes
});
// Pass adapter, file and the host's PodWriter to runFileImport as usual.
```

`csvFormat` can also constrain detection to `revolut`, `monzo` or `starling`.
Hosts build format pickers from `BANK_CSV_FORMATS` and check user input with the
adapter's own `validateBankOptions` (labels: visible text, at most
`MAX_BANK_ACCOUNT_LABEL_CHARS` = 256 Unicode code points). The Node CLI and Suite's connect
flow both pass these options.
`accountLabel` distinguishes accounts absent from an export; keep it stable across
overlapping imports. Only the Revolut, HSBC UK, Monzo and Starling CSV layouts use it.
OFX/QFX and generic CSV files ignore it, still replace the one shared
`finance/bank-transactions.ttl`, and the import adds an `unsupported` entry saying the
label was not used (the entry never repeats the label).

**Label normalisation.** The adapter normalises a label once, and that one string is both
hashed into the account folder name and stored as the account's `skos:prefLabel`:

- A label holding a bidi control, an Arabic prepended mark (U+0600–U+0605, U+06DD, …), a
  noncharacter or a lone surrogate, or longer than 4096 UTF-16 units, is rejected rather than
  cleaned, because what it shows would differ from what is stored.
- Other control and format characters (`Cc`, `Cf`) are removed. A joiner or tag character is
  kept only where it does visible work: ZWJ between emoji, ZWNJ between letters of a script
  that shapes with it (Persian, Indic), and tags inside a well-formed subdivision flag (2–6 tag digits or lowercase tag
  letters). Stray
  ones would split one account into look-alike folders or carry hidden text.
- The rest is put in NFC, every whitespace run (tabs, line breaks, no-break spaces) becomes
  one space, and the ends are trimmed.
- A label with no visible character (only fillers, combining marks or variation selectors)
  is rejected, and the 256 limit counts code points of the normalised form, so an emoji
  counts once.

`"Joint\u0001"`, `"Jo\u200Dint"` and `"Joint"`, or the NFC and NFD spellings of `"Café"`,
are the same account. A plain single-spaced label is unchanged by normalisation. Folder hashes
use the runtime's Unicode tables, so a character assigned in a newer Unicode version may
normalise differently on an older runtime. Revolut defaults to one account per Product/Currency. Monzo
and Starling default to one account per bank/currency; provide labels when importing
multiple accounts.
Changing or adding an `accountLabel` later creates a new per-account document;
keep labels stable to avoid duplicate transactions across documents.

Generic CSV and OFX/QFX retain `finance/bank-transactions.ttl` under the connector
container, with their original `schema:Invoice`/`fin:TransactionRecord` mapping, IDs,
datatypes, Invoice Type Index registration and replacement snapshots. Revolut, HSBC UK,
Monzo and Starling instead write Suite Money's generated wire format through
`@jeswr/solid-money` (`MoneyDocument`, `putAccount`, `putTransaction`; read back with
`parseMoney`), sharded per account and month inside the connector container:

```text
finance/bank/<bank>-<account-slug>/account.ttl             #it        fin:FinancialAccount (skos:prefLabel)
finance/bank/<bank>-<account-slug>/<YYYY-MM>.ttl           #txn-<id>  fin:Transaction
finance/bank/<bank>-<account-slug>/<YYYY-MM>-part-<n>.ttl  overflow parts, n = 2, 3, …
```

The account slug is the SHA-256 hash of the account key, never a raw account number,
and `<id>` is the SHA-256 transaction identity below. Months come from solid-money's
`monthKey` (the UTC month of `postingTime`, as in Suite Money). Each transaction carries
`pm:account` to the account, `schema:description`, `fin:postingTime` and a
`fin:hasMonetaryAmount` node with the signed exact decimal `schema:value` and uppercase
`schema:currency`; amounts never pass through JS numbers. Every touched document is read
first, edited with `putAccount`/`putTransaction` (which upsert by subject and reuse the
stored amount node) and replaced under the read's ETag precondition, so re-importing
overlapping statements merges by transaction ID and never duplicates. Stored blank-node
labels are compacted on read so repeated imports do not grow the documents. Transactions
absent from a later export are kept. Both registrations (`fin:FinancialAccount`,
`fin:Transaction`) point at the `finance/bank/` container. **Provenance:** each transaction's
(and each document's) `prov:wasDerivedFrom` names the account document, not the imported
file. The import session would otherwise record the run's `urn:solid:connector:…:export`
source, and Suite Money's validator rejects any non-http(s) `prov:wasDerivedFrom`, so its
reader would refuse every imported transaction. `prov:wasGeneratedBy` still names the import
run in `_provenance.ttl`. Imports in either layout leave the other
layout untouched. Revolut's imported amount is `Amount - Fee` using exact decimal
arithmetic, including negative fees (fee refunds). Only COMPLETED Revolut rows import;
other states count in `report.skipped`.

**Per-document budget** (`BANK_DOCUMENT_BUDGET`): at most 2,000 transactions and 4 MiB per
month document, measured before writing as N-Triples bytes (an upper bound on the Turtle
the writer PUTs) plus an allowance for the provenance the import session adds. Readers
parse through `@jeswr/fetch-rdf`, whose defaults are 16 MiB and 1,000,000 quads; a full
document uses at most a quarter of the byte limit and fewer than 30,000 quads. A month that would
exceed the budget continues in the next `-part-<n>` document (new transactions go to the
last part; existing ones are updated where they are stored). Re-imports read the first
month document and each following part until one is absent. More than 1,000 parts for one
account-month, a single transaction above the byte budget, or an update that would push a
stored document over budget fails the import with `BankDocumentBudgetError`; nothing is
truncated.

**Per-import budget**: at most 50 accounts and 600 documents per import. A statement export
covers one account; Revolut splits it into one account per Product and currency pocket, and
50 covers every pocket an export can hold. 600 documents is 50 years of monthly documents for
one account, or 12 accounts over 4 years. Planning also caps cumulative stored RDF at
32 MiB of N-Triples before retaining shard copies. The parser fails as soon as a 51st account, or the 601st account
plus account-month document, appears, before any Pod read. Planning then counts every
document it reads (account documents, stored month documents and parts, and the one absent
part probed after the last stored part, which is reused if the month needs a new part) and
fails before the 601st read; a re-import over stored months costs about two reads per month.

**Failure and retries.** Every budget error is raised while parsing or planning, so nothing
is written. Writes then happen one document at a time (account document first, then months
in order). A failed write, such as a 412 from a concurrent change or a network error, stops
the import with the earlier documents already written; re-running the same import converges,
because every write re-reads the document and upserts by transaction ID. Every replacement
uses a strong ETag from the planning read. When that read has no strong validator the
replacement is refused. New documents use create-only writes.

**Posting-date window.** Known-bank rows must post between 1970-01-01 and one year after
the import (date-only values at UTC midnight). Rows outside the window are skipped and
counted in `report.skipped`, so a corrupt export cannot spread rows across thousands of
months (dates may otherwise use any year 0001-9999). Generic CSV and OFX keep their original
date handling.

**Omitted bank fields.** solid-money's model has no fields for these, so they are not
written (no hand-written accessors are added): Monzo Transaction ID (it still keys the
hashed transaction subject), Revolut/Starling running balance (identity only), Revolut
Type, Product, State and Started Date (Product still separates accounts), Monzo Time,
Type, Emoji, Category, Local amount/currency, Notes and #tags, Address, Receipt,
Category split and Money Out/In (Description only serves as a fallback, below), and Starling Type, Spending Category and
Notes. Folded into `schema:description` instead: Starling's Reference (`<Counter Party> —
<Reference>`) and a nonzero Revolut fee, appended as ` (fee <fee> <currency>)`; zero fees
are omitted. Monzo and HSBC day-only dates stay `xsd:date`.

**Descriptions.** solid-money rejects a description that is empty once control characters
are stripped. When the primary description has no visible text the row falls back to the
bank's own columns (Monzo: Name, then Description, then Type; Revolut: Description, then
Type; Starling: the visible parts of Counter Party and Reference, joined with ` — `, then
Type). A row with no visible text in any of
them is skipped and counted in `report.skipped`, as are HSBC rows with an empty description.
An `accountLabel` must likewise contain visible text.

When upgrading from the generic-only importer, recognised-bank imports read the
older shared document through the existing reader port and compare Invoice
descriptions, amounts and dates, including the old generic representation of
Monzo/Revolut rows. Matching transactions produce this run-report warning in
`unsupported`: "N transactions from this statement also exist in the older shared bank document; remove them there or re-import that document with a generic/OFX file to avoid double counts."
Nothing is deleted automatically. The comparison is bounded to 100,000 Invoices,
1,600,000 quads and 64 MiB of term characters; exceeding a bound reports that the
older shared document needs a manual duplicate check.

No exchange rate is inferred:
Monzo local amounts/currencies do not replace the account amount/currency.

Bank-specific dates use strict calendar validation and typed `xsd:date`/`xsd:dateTime` values.
Revolut uses Completed Date. Its optional `timeZone` is validated as an IANA name
and defaults to **Europe/London**, independent of the host's zone. Repeated wall
times select the earlier instant; gaps advance by the transition's duration,
following [Temporal's compatible rule](https://tc39.es/proposal-temporal/docs/zoneddatetime.html#static-methods).
Explicit timestamp offsets take precedence. Bank-specific day-only UK dates stay
day-only; OFX retains its previous `xsd:dateTime` at UTC midnight. Generic CSV
keeps its original date parsing and `xsd:dateTime` values. Bank-specific currency
codes must be uppercase ISO 4217 codes supported by the runtime's ICU data
(`Intl.supportedValuesOf('currency')`). Invalid bank-specific amounts,
currencies, dates and rows count as skips.

Bank-specific CSV SHA-256 identifiers use account identity plus Monzo Transaction ID
when available. Otherwise they hash posting date, description, canonical amount,
currency and balance (when present). HSBC additionally includes a per-file
occurrence index for identical (date, description, amount) rows, so repeated
purchases remain distinct and re-importing the same file stays idempotent.
Overlapping exports of a day with identical HSBC rows rely on row order and
consistent inclusion of those occurrences; partial overlaps cannot establish which
identical purchase is which. Filenames never enter bank-specific keys.
Generic CSV and OFX/QFX keep their original IDs and snapshot behavior.

Bounds: 64 MiB declared/actual file bytes, 100,000 CSV source rows including skipped and malformed
rows, 1,024 CSV columns, 64 KiB header characters, 4 MiB logical CSV records,
16 KiB characters per bank-specific CSV field and 64 digits per bank-specific amount.
OFX/QFX retain the original imported-row limit and the shared scanner caps transactions at 64 KiB bytes. Exceeding the bank-specific row/file cap fails before saving
transaction data; oversized/malformed records are skipped at safe boundaries.
Generic CSV imports truncate to the first 100,000 source rows and return a warning
in `report.unsupported`; skipped and malformed rows consume that allowance too.
Unterminated quoted CSV fails. Formula prefixes remain inert literal data.
Parsing and validation finish before the first data write, and cancellation closes
the input reader and prevents subsequent Pod operations through the shared runner.

**Suite Money integration gap in this checkout:** known-bank imports now use Suite Money's
wire format, but they stay inside `integrations/bank-statements/finance/bank/`, while Money
reads only `<storage>/money/accounts/` and `money/transactions/` and does not discover this
connector's Type Index entries. Generic CSV and OFX keep the Invoice model. This adapter
preserves the writer's confinement; imports do **not** automatically appear in Money. A host
integration/migration is required to bridge the destinations. No Suite app files are changed.
The bridge must also handle re-imports: `putTransaction` rewrites every Transaction field it
owns (account, description, category, payee, derivedFrom, debit/credit account, posting
time and amount), so once Money writes categories or payees into these documents, a
re-import of the same transaction would erase them.

## Node CLI

Build the package and run `pod-connectors import spotify`, or
`node packages/pod-connectors/dist/node/bin.js import spotify` from the workspace.
`import netflix --file ./NetflixViewingHistory.csv` uses the file runner. Add the bare
`--since` flag to an API import to resume its stored cursor; omission starts a full import.
File imports reject `--since`. `--help` prints usage.

Bank statement imports accept two more flags, and only with `import bank-statements --file`:

```sh
pod-connectors import bank-statements --file ./hsbc.csv --format hsbc-uk --account-label "HSBC everyday"
pod-connectors import bank-statements --file ./monzo-joint.csv --account-label "Monzo joint"
```

`--format <auto|revolut|hsbc-uk|monzo|starling>` maps to the adapter's `csvFormat`
(`BANK_CSV_FORMATS`); `auto`, the default, detects the layout, including generic CSV and
OFX/QFX. `--account-label <text>` maps to `accountLabel` and must pass the adapter's
`validateBankOptions` (visible text, at most 256 code points once normalised, as above).
`--format hsbc-uk` requires a label, so headerless HSBC UK exports import from the CLI.
For Revolut, HSBC UK, Monzo and Starling CSV exports, give two accounts of the same bank
different labels, or they share one account folder. OFX/QFX and generic CSV ignore the
label and replace the shared document, so a label cannot keep two such files apart.
Each value must be its own argument: `--account-label=<text>` and a value starting with
`--` are rejected with the usage text. Invalid values, repeated flags and bank flags on
other connectors fail with exit code 2 before the config file is read or any Pod request
is made; the CLI never echoes the label.

Streaming adapters receive the stat
size and `stream()`/`slice()` backed by bounded filesystem read streams; the CLI never
loads their entire upload. `text()` remains capped at 64 MiB. The whole-upload size limit
applies only to adapters without `streaming: true`.

Add `--vault <private-directory>` and set `CONNECTOR_VAULT_KEY` to canonical padded
standard base64 encoding of exactly 32 random bytes to retain encrypted refresh credentials.
`--vault` without `CONNECTOR_VAULT_KEY` exits 2 and names the missing variable on stderr.
A key without `--vault` prints one stderr warning and continues with memory-only credentials.
An invalid key with both settings fails closed. The CLI deletes `CONNECTOR_VAULT_KEY` from
`process.env` immediately after reading it, so child processes never inherit it. The CLI tries refresh before interactive login and persists
rotation before using the access token. Revocation deletes the record and reports exit 3
with a reconnect message; re-run explicitly to log in again. An unreadable record (for example
after a key rotation) starts loopback login, whose code exchange replaces it. Library hosts may
pass `interactiveLogin: false` to `runCli` to never start login: missing or unreadable
credentials then exit 3. Set `connectors[id].account`
to a stable provider account id or owner-chosen label (default `default`). Use a separate
directory per owner/configuration and label per provider account. Changing either selects
a different record. Access tokens, Pod credentials and client secrets remain in memory.

The CLI reads `~/.config/solid-mcp/config.json` (W9 MCP-12's location). It refuses symlinks,
non-regular files, another user's files, and any mode other than **0600**, including 0400.
Set `chmod 600 ~/.config/solid-mcp/config.json`. The current MCP-12 spec has no JSON schema;
CON-03 uses these camelCase fields pending confirmation in root `QUESTIONS.md`:

```json
{
  "podRoot": "https://pod.example/alice/",
  "webId": "https://pod.example/alice/profile/card#me",
  "oidcIssuer": "https://issuer.example/",
  "clientId": "<CSS account token id>",
  "clientSecret": "<CSS account token secret>",
  "readOnly": false,
  "connectors": {
    "spotify": { "clientId": "<registered public source client id>" },
    "twitch": {
      "clientId": "<registered Twitch client id>",
      "tokenProxyUrl": "https://proxy.example/twitch/token",
      "callbackPort": 49152
    }
  }
}
```

Optional `tokenUrl` pins the Pod token endpoint instead of discovering it. Optional
`profileDocumentUrl` pins the canonical profile document; otherwise the WebID without its
fragment is used and any redirect is refused. URLs use HTTPS. `readOnly: true` refuses the
import. Each `connectors[id]` may also supply `tokenProxyUrl` or an installed-app
`clientSecret`. A local source secret selects direct exchange with the adapter's HTTPS token
endpoint, taking precedence over a token proxy. Without a local secret, the adapter's configured
proxy mode is preserved. Client secrets and access tokens remain in memory; refresh
credentials may use the optional encrypted vault described below.
Token endpoints and proxies require HTTPS, except HTTP on `localhost`, `127.0.0.1` or
`[::1]` for development proxies. Direct exchanges request JSON token responses, including
GitHub; form-encoded token responses are unsupported. `scope` accepts a string or an array
of strings (Twitch), normalized with `join(" ")`; other scope types are dropped. The provider's `tokenRequest`
selects form-post secrets (the default), HTTP Basic with a form body (Fitbit), or HTTP Basic
with a JSON body (Notion) for a local secret. Proxy flows keep the shared form contract.

Pod login uses `forClientCredentials` from `@jeswr/pod-auth/node` for CSS client credentials,
DPoP, bounded nonce retries and memory-only tokens. Its fetch feeds storage-client's Solid
backend and `createStoragePodWriter`. The small `node/pod-auth.ts` adapter retains the config's
explicit token URL and grants a separate static agent boundary to a validated cross-storage
Type Index document. It never grants that storage's entire root. Shared agent initialization has no
caller signal; cancelling one caller leaves other callers able to proceed, and rejected
initialization can retry. Serialized RDF strings travel as immutable Blobs for creates and
updates, preserving their preconditions without imposing the ordinary replay-size cap. The
transport refuses redirects and preserves each request's cancellation through discovery, token
refresh and nonce retries. Source login displays a browser URL, binds only `127.0.0.1` on an
OS-assigned port by default, and uses state plus S256 PKCE. Set `connectors[id].callbackPort`
to an integer from **1024 to 65535** for a fixed loopback callback. Twitch requires this
setting with either a local secret or a token proxy; omitting it fails with a configuration
error before opening the browser. Register the exact URI
`http://127.0.0.1:<callbackPort>/oauth-callback` with the provider (for the example above,
`http://127.0.0.1:49152/oauth-callback`). The host and path cannot be configured, and a busy
port fails login without falling back to another port. The flow times out after two minutes.
Pod and source transports never share credentials;
all authenticated transports refuse redirects. SIGINT/SIGTERM cancel the CLI.
Profile-selected Type Index documents must also use HTTPS, even in another advertised storage.
After source login, the CLI selects the adapter's optional `createSourceAuth` factory,
falling back to the generic bearer transport. Spotify refreshes expired access tokens in
memory through this factory. With a vault configured, the CLI uses the shared OAuth source
session so every rotation is persisted. An explicit `options.sourceAuth` bypasses login,
the factory and vault wiring.

The standalone CLI verifies owner-only WAC for every `private` connector's imports by default,
using the authenticated Solid client that writes the payload. It checks the checkpoint destination
before protecting the checkpoint and verifies every import and checkpoint destination before and
after writing. The CLI prints the destination URL with an after-write refusal. Node hosts
can supply `verifyPrivateDestination` and `confirmPrivateWrite` to `runCli`. Both receive the
exact URL, storage client, authenticated fetch and owner WebID. Pre-write verification
receives the run signal. Confirmation receives the write ETag when present and can report
its first HEAD's strong ETag via `observeEtag` for conditional cleanup.

The CLI stores `<podRoot>integrations/<id>/state.json`, including failed outcomes while
retaining the last successful checkpoint. Before accessing JSON, it discovers the resource's
`rel="acl"` link and writes a WAC ACL granting only the owner WebID Read, Write and Control.
The ACL must be in the same connector container. Missing ACL discovery or rejected ACL
writes fail closed; ACP/LWS state protection belongs to later storage integration.
Conditional JSON PUTs reject stale ETags and concurrent creates. Cancellation stops new
source requests and regular Pod operations. In-flight OAuth token and revocation requests
keep their own timeout. A dispatched private PUT or DELETE finishes,
and checkpoint confirmation and cleanup can continue after cancellation. The CLI writes a
checkpoint only after all payloads and run provenance have been confirmed. If checkpoint
confirmation fails, the CLI reports the refusal and intentionally keeps any surviving
checkpoint because its cursor points to confirmed data and deleting it would force a full re-import.
State persistence failures fail the command, and deterministic slugs allow retry.

Exit codes: **0** success/help, **1** import/state failure, **2** usage/config/file error,
**3** Pod/source login failure, **130** cancellation. Error output uses constant messages
and excludes server responses, tokens, and arbitrary exception text.

Programmatic hosts can import `runCli`, `authorizeLoopback`, `createClientCredentialsFetch`,
and `createStateStore` from `./node`. `runCli(args, options)` takes output callbacks,
`configPath`, independent `podTransport`/`sourceTransport`, an abort signal and an optional
`openAuthorizationUrl` callback. For headless tests pass fixture-backed
`sourceAuth: { fetch }` (including a fixture recorder); Pod client-credentials exchange can
run against a stub transport over the memory Pod. Importing `./node` starts no command or listener.
`authorizeLoopback` accepts the same optional `callbackPort` in its source config.
The fetch returned by `createClientCredentialsFetch` preserves the effective request signal
(`init.signal` overrides a Request's signal), including request-body buffering, token refresh
and DPoP nonce retries. Cancellation rejects with the abort reason and cancels the body reader.
Already-aborted requests reject before any resource request or refresh is sent.
Checkpoint JSON reads enforce a 1 MiB byte limit using both content-length and streamed chunks,
and cancel oversized response bodies.

## Google Contacts

`./adapters/google-contacts` imports People API connections with the sensitive
`contacts.readonly` scope (Tier B). It uses the shared Google OAuth configuration and
follows every page, persisting only the final `nextSyncToken`. An expired token (HTTP
410 or HTTP 400 with `EXPIRED_SYNC_TOKEN` in error details) discards partial pages and
retries a full sync once. Source errors and missing final checkpoints cause no contact
writes or deletions. The shared JSON byte cap and one run budget bound source responses,
page requests and buffered people, including discarded pages before a full-sync retry.
Pod failures retain the previous checkpoint; writes across separate
documents are not transactional and a retry reapplies the source changes.

The connector contains the SolidOS vCard layout: `contacts/index.ttl#this` is the
`vcard:AddressBook`, `contacts/people.ttl` holds names and `vcard:inAddressBook` links,
and `contacts/Person/<pathId>/index.ttl#this` holds each `vcard:Individual`. Names,
emails, phones, addresses, organizations and birthdays use vCard predicates and named
linked nodes where appropriate. Email addresses are percent-encoded for `mailto:` URI syntax,
preserving the address separator. Organization `jobDescription` maps to `vcard:role`, and
`title` to `vcard:title`. Year-less birthdays use `xsd:gMonthDay`; invalid dates are omitted.
Unusable phone IRIs retain their raw literal, and malformed optional fields are omitted.
Malformed person ids count as skipped; nameless people retain an unnamed-contact label.
Each person document derives from its Google Contacts page. The Type Index registers
only `vcard:AddressBook` for `contacts/`. No contacts sector constant exists in the current
federation bridge, so its `vocabMap` preserves vCard without adding an alignment type.

Incremental deletions and validated `metadata.previousResourceNames` remove former person
documents through conditional `ctx.remove` calls. Full resyncs list canonical person documents
under `contacts/Person/` and remove those absent from the snapshot, recovering unindexed writes
left by a failed run. Unchanged people survive
increments, and `people.ttl` is replaced once per successful run. A missing local membership
index forces a full sync. Synthetic fixtures, memory Pods and the sorted Turtle mapping
snapshot exercise these paths without contacting Google.

## Incremental imports and provenance

Pass host-owned `state: ConnectorState` into `runImport` (or `runFileImport`) and persist
`report.state` after success. `onState` also receives failed outcomes, preserving the previous
successful cursor, sync time and counts. State contains ISO date strings and never tokens or
exception text. An explicit `cursor` overrides the state's cursor for API imports.

**One run per connector at a time.** Imports reconcile against their own reads (source
inventories, collection documents), so a second `runImport`/`runFileImport` for the same
connector container while one is running in this process is refused ("already running").
Hosts that share a pod across processes (for example the CLI and a browser app) must not run
the same connector concurrently; the conditional writes then fail an overlapping run with 412
rather than merging it.

The shared write pipeline reads each deterministic slug before writing. Documents default to
replacement (`writeMode: 'replace'`), preserving snapshot behavior for Spotify, GitHub and other
existing adapters, including empty snapshots and deletions from a dataset returned by `ctx.read`.
Incremental adapters can set `NormalisedDoc.writeMode: 'merge'` to replace descriptions of incoming
deterministic named subjects while retaining subjects absent from the current page.
`schema:identifier` is descriptive metadata and may be shared by distinct items (for example,
lines of one Amazon order). Adapters must use deterministic linked-node identifiers and implement
source-specific deletions with replacement writes. ETags and create-only conditions protect both
write modes; a 412 surfaces to the host without advancing its checkpoint. Repeated writes re-read
the current ETag.

Item counts retain one counter per written document. Replacement counts the adapter's current
local subjects (excluding the document URL); merging counts each local source subject once per document
in the current run, using stored provenance to detect repeats. Removal drops the document's
count. Subjects added only by sector mappings, and subjects an adapter lists in
`NormalisedDoc.carriedForward` (kept unchanged from the stored document), are excluded.
Session accounting therefore scales with documents, including when Takeout releases its reconciliation manifests.

Run provenance retains at most `MAX_RUN_SOURCES = 1,000` distinct source IRIs, including
the connector's own source IRI, added first. `createImportSession` accepts `maxRunSources`
to lower this limit (minimum 1). Once full, the run summary ignores further sources;
every document and item still retains its complete `prov:wasDerivedFrom` derivation.

Imported documents and resources inside the writer's resolved connector container carry
`prov:wasDerivedFrom` and `prov:wasGeneratedBy`. Externally linked identities retain their
required typing without import-generation provenance and are excluded from item counts. Item
`schema:url` supplies its source; `NormalisedDoc.sourceUrl` can supply a document-specific
fallback. Otherwise the source API origin or a connector export URN is used. Each run has one
activity in the connector's reserved `_provenance.ttl`, with the bounded source summary,
connector IRI and start/end times. This companion document is excluded from imported-document
counts and Type Index registration. Failed runs attempt provenance recording and retain the original error.
A cancelled run makes no further Pod request, so it records no activity: documents and items it
already wrote keep `prov:wasGeneratedBy` naming an activity absent from `_provenance.ttl`. Read
such an unrecorded activity as a cancelled, incomplete run for adapters without bounded
history. Polling adapters can prune completed summaries through `maxRunActivities`, so
absence alone does not establish cancellation for those adapters. The next run that rewrites those
documents or items links them to its own recorded activity. `runImport` checks its signal at the
PodWriter boundary, immediately before every port call, so a cancel while a session's implicit
read or the provenance read is pending still stops the write that follows and the run rejects
with the abort reason. Pass the same signal as `createFetchPodWriter({ signal })` to check it
before every HTTP request inside a port (binary ETag reads, Type Index and profile updates) and
to abort requests in flight.

Each adapter exposes a `vocab-map.ts` seam, applied by the runner without mutating adapter
input. Existing music, calendar and social class alignments add sector types alongside legacy
types. Detailed adapter field mappings remain with their later connector tasks. Namespace
bases come from `@jeswr/suite-vocab` (`NS`), with adapter terms assembled in
`core/federation-vocab.ts` and adapter vocab modules. Import-session reads and run provenance
resolve legacy `https://w3id.org/jeswr/` vocabulary predicates and class IRIs through
`canonicalize()` before typed access and incremental reconciliation. Rewrites of these
connector-owned documents use canonical jeswr vocabulary while resource identifiers, literal
contents and standard namespaces retain their spelling (mail keeps `http://schema.org/`).
Shared WebID profiles and Type Index datasets retain their raw terms. Type Index comparisons
accept legacy classes without changing existing registrations; only new registrations use
canonical class IRIs.

## Streaming file imports

Apple Health, Netflix, Amazon orders, Uber, WhatsApp, Goodreads, Steam, ChatGPT
and bank statements prefer the native `File.stream()` byte reader. Text-only
`ImportFile` implementations remain compatible. CSV rows (including quoted
newlines), XML start tags, OFX transactions, multiline chat messages and selected
JSON array members are parsed incrementally. UTF-8 decoding spans chunks; readers
are released or cancelled when parsing ends or fails. The 64 MiB limit is also
checked against actual bytes read. Existing deterministic documents and the
100,000-record cap are preserved: RDF snapshots remain in memory up to that cap.
Non-JSON readers retain chunk slices with independent UTF-8 byte limits:
64 KiB per XML tag, 1 MiB per XML text node or text line, and 4 MiB per
CSV data record (including quotes and embedded newlines). XML character data,
comments and CDATA retain no text. Apple Health retains only `Workout` tags;
ignored tag attributes are scanned without buffering. Oversized tags, text nodes, lines and CSV
records are discarded through the next safe boundary and counted in
`report.skipped` and `report.state.counts.skipped`. Unterminated XML markup or
quoted CSV records fail with an explicit error. A skipped WhatsApp line also
discards the pending message and continuations until the next timestamp.
CSV headers are parsed and normalised once per file, including known bank header
signatures, and are limited to 1,024 columns and 65,536 characters.
CSV data tokenization retains only as many cells as the header contains. Extra
fields are scanned without retaining their text, and the entire row is skipped
and counted. WhatsApp constructs each message directly from coalesced slices,
with a 1 MiB UTF-8 message limit and at most 10,000 continuation lines. The byte
limit includes the timestamp and sender plus one LF between lines. Overflow
discards the message and counts one skip, then ignores continuations until the
next timestamped message. Transcripts are never joined and reparsed.
OFX transactions use an incremental delimiter scanner and are limited to 64 KiB
of UTF-8 text. Oversized or unfinished transactions are skipped and counted in
`report.skipped` and `report.state.counts.skipped`.
JSON parsing retains chunk slices with a 1 MiB UTF-8 token limit and a 4 MiB
record limit. Oversized selected members or fields are discarded and counted
once; overflow outside a selected record fails the file. Ignored strings are
validated without retaining their text, and structural failures cancel the reader.
Select the extracted export file, rather than the ZIP archive.

Per-importer vocab maps retain legacy schema.org/FOAF types and source fields,
adding federation health, finance, media and social types where the ontology has
an appropriate term. The Apple Health document is a `health:HealthRecord`;
workouts remain `schema:ExerciseAction` because the sector has no workout event
class. Financial lines are `fin:TransactionRecord`, viewing events are
`media:ListeningActivity`, books/games/conversation documents are
`media:CreativeWork`, and WhatsApp messages are `social:Note`. Uber journey types
and all existing category/Type Index registration classes are preserved. See
root `QUESTIONS.md` for conservative mappings where the spec leaves terms open.
Sector mappings also carry the required shape properties: creative works have
`dcterms:title`, notes have `social:content`, and health records name an unnamed
local `core:Person` through `core:subject`. Financial records use the importing
user's WebID as `core:subject`, typed `core:Agent`. The fetch-backed writer exposes
its configured WebID; custom `PodWriter` implementations must supply `webId` for
financial file imports and Steam account metadata. Steam accounts link to that WebID
as a `core:Agent` and `core:AccountHolder`, and to Steam's public site as a
`core:AccountProvider`. Imports fail before writing the affected document when
that identity is missing or invalid. Financial activities retain the broad
`core:Activity` type because exports may omit the currency or posting time needed
by the `fin:Transaction` shape; missing source facts are not inferred.
The pinned core and finance ontologies provide no Record → Activity relation:
`core:about` has the range `gufo:Endurant`, disjoint with an activity's `gufo:Event`.
Financial activities remain separately typed without that link. Financial records
emit a direct `core:about` link to the same typed WebID used by `core:subject`; `core:Agent` inherits `gufo:Endurant`, satisfying the
range. SHACL does not materialise the subproperty entailment.
Goodreads books, Steam items/accounts and conversations with a ChatGPT id carry
their source item URL for provenance; other records use the connector export URN.
No MCP-16 parser is present in this checkout, so ChatGPT reuses its existing
conversation parser for each streamed conversation.

Synthetic fixture tests cover every importer with one-byte, seven-byte and
single-chunk input, sorted Turtle mapping snapshots, provenance and stable
re-import. Every Tier C fixture snapshot is validated with the pinned
`rdf-validate-shacl` against the checked-in core and sector shapes. The pinned ontology class
hierarchy enables inherited targets and linked-class checks; property
entailments are not materialised for validation. Warning/Info results remain
advisory; every Violation fails the test. Negative tests remove required links
and typing to verify that the validator detects them.
Domain/range consistency checks also follow named superclass and subproperty
chains over the pinned ontology import closure, including gUFO disjointness.
The Apple Health streaming test lazily generates over 50 MiB of
`export.xml` and retains only workouts. Tests make no production requests.

## Recording fixtures

```ts
import { createFixtureRecorder } from '@jeswr/pod-connectors/testing';

const recorder = createFixtureRecorder({
  fetch: injectedSourceFetch,
  routes: [{
    url: 'https://source.example/items', // public static prefix, no query/fragment
    safeFields: ['total', 'items.*.syntheticId'], // explicitly non-personal scalars
  }],
});
// Pass recorder.fetch through SourceAuth; save recorder.fixtures() in the host.
```

Recording preserves the original response for the adapter. Saved fixtures contain the static
route prefix, method, status and redacted JSON only. The recorder uses guarded-fetch's
`snapshotFetchInput` to select a route from the real request target and forward that same
snapshot, ignoring shadowed Request URLs and capturing mutable URLs once.
Recording and replay select the longest
matching prefix on the same origin and complete path segments, independently of route or request
order. Responses sharing a method and static prefix replay in request order, even if recording
responses complete out of order. Repeated
keys form a finite sequence; replay fails when that sequence is exhausted. Single-entry keys
remain reusable for existing static demo fixtures. All headers, request bodies, dynamic URLs
and unlisted JSON fields are omitted. Known token, cookie and personal keys cannot be
allowlisted; empty allowlists are the default. Hosts must ensure every allowed scalar is
non-personal and use synthetic replacements when replay requires personal fields. Tests use
mocked source transports and memory Pods only.

## Google Calendar

`./adapters/google/oauth` exports `createGoogleOAuthConfig(product, options)` for
`calendar`, `contacts`, `drive` and `gmail`. Each configuration requests only that
product's read scope. Browser hosts inject `{ clientId, tokenProxyUrl }` and use the
existing proxy exchange. Node hosts pass `{ clientType: 'desktop', clientId,
clientSecret? }` from their own Desktop OAuth configuration and use the shared
code exchange with a loopback redirect and S256 PKCE. The installed-app value is
sent only in the direct token POST, never in the authorization URL or proxy form.
Keep it out of browser configuration and persisted connector state. Tokens remain
in memory; this module does not implement the CLI login (CON-03).

The Calendar adapter reads the primary calendar, follows every `nextPageToken`,
and returns the final `nextSyncToken` as its cursor. Incremental runs retain
unchanged events and apply updates/deletions by event id. A 410 discards partial
changes and retries a full snapshot once; a missing local document also requires a
full snapshot. No event document is written until every page and the checkpoint
are available, so a failed resync keeps the previous data and cursor. ETag
preconditions still apply.

Events retain `schema:Event` alongside the defined `sched:CalendarEvent` class.
All-day start/end values use `xsd:date`, preserving Google's exclusive end date;
timed values use `xsd:dateTime`. Offsetless timestamps use the event's IANA time zone,
falling back to the calendar's list-response time zone; with neither zone they remain
floating. Repeated daylight-saving times select the first occurrence; nonexistent local
times or invalid zones fail before writing or advancing the checkpoint.
Recurrence rules use VOC-01's structured fields
and deterministic linked nodes, with `schema:Schedule` as an additional type and
`schema:scheduleTimezone` for the source time zone. Each event supports at most one
RRULE; multiple RRULEs fail before writing or advancing the checkpoint. Interval and count use
`xsd:positiveInteger`; month-day selectors support `1`–`31` and `-1` (last day).
Cancelled items remove their event descriptions and recurrence nodes. Cancelled
instances add `schema:exceptDate` to the master's recurrence without creating an event
record. Cancelled and moved instance exclusions are stored separately from source EXDATEs
in a typed-accessor record under the master, without an event type. Master updates replace
the source EXDATEs and rebuild each rule's exceptions as source dates plus instance exclusions,
so removing a source EXDATE restores that occurrence. Moved instances keep
their deterministic event identities. Deleted-series cleanup runs after every page has
been processed. RFC 5545 constructs outside VOC-01's shape fail before the document write
or checkpoint advance (see root `QUESTIONS.md`). Fixtures and sorted Turtle mapping
snapshots cover these paths without Google accounts or production traffic.

## Google Drive

`./adapters/google-drive` exports `googleDriveAdapter` and
`createGoogleDriveAdapter({ maxBytes })` (default 25 MiB). Drive remains Tier B because
`drive.readonly` is a restricted Google scope. OAuth uses `createGoogleOAuthConfig('drive')`.
The catalog has 36 entries (nine Tier A, sixteen Tier B, and eleven Tier C).

A full import captures `changes/startPageToken` before paginating `files.list`; later
imports replay `changes.list` and persist its final `newStartPageToken`. HTTP 404/410 from
the changes feed triggers one full resync. Full snapshots reconcile missing local files
only after a complete, valid listing. List and changes pages require object envelopes with
`files`/`changes` arrays and nonempty string pagination tokens when present; malformed pages
fail before reconciliation or checkpoint advancement. One shared `RunBudget` caps source
requests (including downloads), listed items, and cumulative JSON response bytes across pagination
and any full-resync fallback (512 MiB of cumulative JSON and downloaded content by default).
Failed imports preserve the host's previous checkpoint.
Removed/trashed files first conditionally rewrite metadata with no encoding links and
`contentSkipped: "pending-deletion"`, retaining the source id and provenance. They then
remove all representations through `ctx.remove` and conditionally delete metadata using its
updated ETag. If cleanup fails, this tombstone remains discoverable for replay or full resync;
a returning file downloads its content again even when its source version is unchanged.

Files have stable paths inside the connector container:
`drive/files/<pathId(fileId)>/meta.ttl`, with `content-<v>` beside binary metadata, or
`content-<v>.pdf` and (for Google documents) `content-<v>.txt` beside exported metadata.
`<v>` is the first 24 SHA-256 hex characters of the checksum, else modified time, else the
downloaded bytes (the first representation for exports). Files without source version fields
are downloaded on every import so changed bytes get a new create-only path.
Folder ids, rather than names, identify folders; `schema:isPartOf` links mirror the Drive
tree without moving resources on rename. Metadata uses `https://schema.org/`:
`DigitalDocument` for files, `Collection` for folders, source id/URL, name, media type,
size and timestamps. `schema:DigitalDocument` is registered once for `drive/`.
`poddrive:md5Checksum` and `poddrive:contentSkipped` use `NS.POD_DRIVE` from
`@jeswr/suite-vocab` (`https://jeswr.org/ns/pod-drive#`).
`schema:encoding` links identify successfully copied content.

Only explicitly owned files are copied. Non-owned files, unknown binary sizes, unsupported
Google Workspace types and files over the cap retain explanatory metadata and do not count
as malformed-item skips. Documents, spreadsheets, presentations and drawings export as PDF;
documents also export as text. Export-limit responses (`403 exportSizeLimitExceeded`) retain
metadata only. Each representation is capped at `maxBytes` (exports also at Google's 10 MiB
limit). Representations use create-only writes; the conditional metadata write publishes their
encoding links only after every download and content write succeeds. Previous versions are
removed after the metadata commit. A failed commit attempts to remove staged representations
while preserving anything linked by the current metadata. Matching checksum/modified-time
metadata and every expected encoding link avoid another download only when no `contentSkipped`
reason is present. The shared runner refuses overlapping imports for this connector container;
hosts sharing the pod across processes must serialize runs. Every successful store lists that
file's container and removes unlinked canonical representations, including abandoned exports
and legacy `content`, `content.pdf`, and `content.txt` paths. This also runs for metadata-only
transitions even when previous metadata has no encoding links.
Malformed and RDF content types are stored as `application/octet-stream`.

Downloads accumulate at most the configured byte cap and cancel/abort oversized responses.
`PodWriter.writeBinary` currently takes `Uint8Array`; true streaming request bodies require a
future writer port. JSON-only demo fixtures show metadata; sync tests wrap `fixtureFetch`
with synthetic byte responses for media/export routes, without changing its public behavior.
## Spotify Web API

The `spotify` catalog id also supports `fileAdapterById('spotify')` (direct module:
`./spotify/file-adapter`). Request Extended streaming history or Account data through
Spotify Account → Privacy settings → Download your data. Select the ZIP or a single
`Streaming_History_Audio_*.json`, `Streaming_History_Video_*.json` or
`StreamingHistory_music_*.json`. Older exports' `MyData/endsong_N.json` (extended) and
`StreamingHistoryN.json` (account data) are accepted too; each row's fields decide how it
is read. A ZIP with none of these names fails with "No Spotify streaming history found in
this archive." No Web API application is needed for file import.

File history merges into `integrations/spotify/music/history/YYYY-MM.ttl`, registered as
`media:PlaybackEvent`, inside the connector container. A month splits into contiguous
`YYYY-MM-part-N.ttl` documents (`spotifyHistorySlug`) when a document would exceed 2,000
plays or about 4 MiB of estimated Turtle (well under readers' 16 MiB cap), up to 64
documents a month. The adapter reads a month's existing parts first: a stored play stays in
its part, so re-imports never move or duplicate it, and new plays fill parts in order.

Each play is written by `@jeswr/solid-listening`'s generated scrobble model (`addScrobble`):
a `media:PlaybackEvent` with `media:msPlayed`, `media:playedWork` → a titled `media:Track`,
`media:performedByArtist` → a `foaf:name`d `media:Artist`, `media:inAlbum` → a titled
`media:Album`, and `core:atTime` → `time:Instant`. The event is `#scrobble-<id>` and its
instant `#scrobble-<id>-instant`. Plays of one recording in a document share its
`#track-<key>`, `#artist-<key>` and `#album-<key>` nodes, keyed by a hash of every value the
node describes. Music's top artists and recently played use imported plays; its "most
played tracks" counts only library tracks, so imported plays do not appear there yet.
Recordings are not shared across documents. The model still emits the legacy `w3id.org/jeswr` media/core namespaces; the
adapter stores them under the canonical `@jeswr/suite-vocab` namespaces with
`canonicalizeJeswrDataset`. The adapter writes no hand-built accessors, `schema:` types,
`media:playedVia` or Spotify track link (the generated profile leaves out `playedVia`).
The generated runtime costs a few milliseconds a play, so the 100,000-row maximum takes
minutes. Episodes use their title and show name in that history representation.

SHA-256 ids derive from the UTC timestamp and valid track URI, falling back to artist/title
names; rows sharing an id within one import are one play (the last row wins). Basic
`endTime` is interpreted as UTC at its exported minute precision, so repeats of one
recording ending in the same minute are numbered in file order and the number joins the id
from the second repeat on: re-importing the same file, or an overlapping one, adds nothing. Duration is not
subtracted to invent a start time. Plays under 30 seconds (including zero) are kept,
matching Last.fm/ListenBrainz imports: their 30-second rule deduplicates nearby plays,
and does not filter by duration. Spotify file import deduplicates exact natural keys only.

The same listen can therefore be stored twice: a Basic and an Extended export of the same
plays hash differently, and the live adapter's `music/recently-played.ttl#play-…` overlaps
file history for recent periods. Music reads every part alongside its own history and live
Spotify history, and folds imported duplicates on read: the same normalised title and a
shared artist within 90 seconds, from different sources or with Basic's minute precision
(the precise play wins). A failure reading imported file history never hides Music's own.

Only timestamp, title, artist/show, album and milliseconds are kept; a validated track URI
only feeds the id.
`ip_addr`, `conn_country`, `platform`, reasons, shuffle and skipped flags are dropped.
Rows with `incognito_mode: true` (Spotify Private Session plays, which Spotify keeps out of
the user's history) are skipped and counted as skips; there is no opt-in yet.
Raw files and filenames are never written to the pod. Malformed rows count as skips.
All selected input is verified, and every month's existing parts are read and its new
documents planned, before history writes: invalid JSON, CRC/size/DEFLATE errors, exceeded
limits and a month over the document limit fail before history changes. Months are then
saved one after another, so a Pod error may leave earlier months saved; re-import finishes
without duplicating them.

The shared streaming JSON scanner caps tokens at 1 MiB, records at 4 MiB, nesting at 64,
and each JSON file at 64 MiB. Per run: 100,000 rows including invalid/duplicate/oversized
records, 16 MiB retained metadata, 600 months, 1,000 ZIP entries, 512 MiB compressed input
and 256 MiB actual inflation across selected entries. ZIPs require `stream()` and `slice()`;
the shared Takeout reader validates headers, directory, overlap, encryption, compression,
ranges, size and CRC. Only documented history paths are dispatched; unknown files are not
inflated. Split exports that exceed a cap.

Suite Connect offers history import by default when no host client is configured, and
live PKCE with a personal public Client ID. The setup form shows the exact
`/oauth-callback.html` redirect URI to register in the Spotify Developer Dashboard,
validates 32 hexadecimal characters, and saves `connect.spotify-client-id` through
suite-sdk pod-backed preferences. `NEXT_PUBLIC_CONNECTOR_SPOTIFY_CLIENT_ID` takes
precedence. Personal apps remain subject to Spotify's development-account and user limits.
No client secret is requested, stored or used by this flow.

The Spotify adapter imports saved tracks, playlists with ordered items, followed artists,
short/medium/long-term top tracks and artists, and recently-played history. The existing
`music/top-tracks.ttl` remains the medium-term snapshot. Other top ranges use explicit
range suffixes. Library collections replace snapshots; playback events merge by track id
and played-at timestamp in `music/recently-played.ttl`.

Spotify validates every page before importing its items and uses the shared 32 MiB JSON
response cap and per-run budget (20,000 source requests, including rate-limit retries, and
2,000,000 page items, including skipped entries, plus 512 MiB of cumulative response bytes
counted as they stream). `createSpotifyAdapter(limits)` from
`./adapters/spotify` accepts custom `RunLimits`. Collections are written only after all
source fetching succeeds; malformed responses and exceeded limits retain existing snapshots
and the previous checkpoint. Larger imports fail for the host to handle; this adapter does
not shard collections.

For live PKCE sessions, inject the public client id into `createRegistry` and use the
Spotify-specific source transport so an expired token can refresh once after a 401:

```ts
import { createSpotifySourceAuth } from '@jeswr/pod-connectors/adapters/spotify';

const sourceAuth = createSpotifySourceAuth({
  clientId,
  token, // from authorize(); memory only
  fetch: pristineSourceFetch,
  onToken: updated => { token = updated; }, // optional in-memory host update
});
// Pass sourceAuth and the configured Spotify adapter to runImport in live mode.
```

Only `api.spotify.com` receives bearer credentials. Refresh goes to Spotify's fixed token
endpoint without a client secret or API bearer header; redirects are refused. Concurrent
401s share one refresh. Refresh responses are capped at 64 KiB; oversized or invalid responses
fail with an authentication error without updating the in-memory token. GET retries are
limited to one refresh per request. API 429s wait
for `Retry-After` (seconds or HTTP date), capped to the remaining run duration, with at most
three retries; aborting the run's
`signal` (`RunImportOptions.signal`) ends a pending wait with the abort reason. For every
adapter, `runImport` starts no further source request, Pod read or write, progress report,
Type Index registration or provenance write once that signal aborts. Playlist item 403/404
responses retain the playlist metadata and count its inaccessible contents once in `skipped`;
other failures reach the host without advancing its checkpoint. Unusable or oversized delays
surface as `RateLimitedError` for the host to schedule later.

The opaque successful cursor is `after:<epoch-ms>` of the newest imported play. Hosts may
supply `before:<epoch-ms>` for an explicit older-history import. Pagination follows the
API's same-resource `next` URLs. Persist `report.state` only on success; history absent
from subsequent API windows is retained. Spotify only exposes its available recent history,
so this cannot reconstruct a full lifetime listening export. Events use the federation media
contract incorporating solid-listening's shape: `media:PlaybackEvent` (+ `schema:ListenAction`),
`media:playedWork` → Track, `core:atTime` → `time:Instant` → `time:inXSDDateTime`.
The listener is the implicit Pod owner; no listening duration is inferred from track length.

All demos remain fixture-backed. Public environment-variable configuration belongs to the
host application. Playlist item requests use Spotify's current `/playlists/{id}/items`
endpoint with `additional_types=track,episode` and accept both `item` and legacy `track`
payloads, including podcast episodes
as `media:PodcastEpisode` plus `schema:PodcastEpisode`. Items are requested only for playlists
owned by the current user or marked collaborative. When `scopes` (`RunImportOptions.scopes`)
withholds `playlist-read-private` or `playlist-read-collaborative`, listed playlists of that
kind are omitted after the bounded, budgeted list read and their items are not requested.
Spotify also leaves withheld kinds out of `/me/playlists`, so while either playlist scope is
withheld every previously imported playlist this run does not describe (with its list items
and tracks) carries forward into the replaced `music/playlists.ttl` without counting as an
imported item; only a run with both playlist scopes drops playlists the source no longer lists. Other adapters ignore `scopes`. Other playlists retain their metadata
without items and count once in `skipped`. Inaccessible contents do not prevent the remaining
resources and recently-played history from importing or the successful cursor from advancing.
## Tier A sync behavior

GitHub repositories, Discord guilds, Twitch follows and Notion search exhaust their API
pages within each run, then replace the snapshot. Page cursors are not persisted as change
checkpoints. Strava traverses activity timestamp windows after its saved timestamp, using
`before` with a one-second overlap and deduplicating activity IDs; Reddit walks saved
posts newest-first to the last saved fullname and snapshots subscribed communities.
Both use framework subject replacement for incremental writes. A cursor-free import
replaces these collections, including items removed at the source.

Before replacing a GitHub repository snapshot, each previously imported ID absent from the
listing is checked with `GET /repositories/{id}`. A 200 keeps the repository and updates its
metadata through the same mapping as listed repositories; a 404 removes it. Any other status
fails the import, retaining the repository snapshot and checkpoint. These verification requests,
returned items and JSON bytes share the import's run budget. Numbered pagination can miss a
surviving repository when an earlier entry is deleted between requests; an omission alone
never removes previously imported metadata.

GitHub, Strava and Reddit use the runner-owned shared-core `RunBudget`. Hosts can inject
`{ maxRequests, maxItems, maxBytes?, maxDurationMs? }` through `createGithubAdapter(limits)`,
`createStravaAdapter(limits)` or `createRedditAdapter(limits)` from their adapter entry points;
the existing singleton exports use the shared defaults: 20,000 requests, 2,000,000 items and
512 MiB of cumulative response bytes with a 30-minute deadline. Omitted fields retain defaults.
Host run limits can tighten these factory settings per key.
Every JSON response is charged as bytes stream in and also retains the 32 MiB per-response cap.
GitHub's profile and repository requests share the same budget; Reddit's identity lookup,
saved posts and subscribed communities likewise share one budget. Identity/profile lookups
count as one item. Page items are counted before buffering, including overlaps, malformed
entries and entries beyond Reddit's saved checkpoint. Exceeding a budget fails without
advancing the checkpoint. GitHub also rejects a page whose valid IDs have
all been seen. Strava rejects any activity at or after the requested `before` timestamp;
a window with no new activity IDs ends traversal successfully, including an overlap-only
terminal window. More than 100 activities sharing a start second can end traversal early.

Dropbox drains `list_folder/continue` before returning its delta cursor. File metadata
updates replace old descriptions, including removed optional fields; deleted path tombstones
remove files and folder descendants. Imports continue to copy metadata only.

Each adapter supplies a document-specific source fallback for provenance. Reddit adds the
federation social Note type. The other Tier A vocab maps explicitly preserve their existing
types where the current sectors have no equivalent (root `QUESTIONS.md` Q2); follows are
not playback events, accounts are not people, and workouts are not clinical observations.
Recorded fixture tests cover sorted Turtle mappings, re-imports, pagination, provenance,
checkpoint retention on source errors, and Dropbox deletions without production API calls.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Garmin archive observations now use the generated `@jeswr/solid-health` write model.
Measured values change from `xsd:double` to `xsd:decimal`; existing monthly paths,
fragment IDs, codes, units and timezone-bearing `xsd:dateTime` timestamps are retained.
Recognised entries are parsed before final Pod writes; malformed JSON entries contribute
no observations, including rows preceding the bad token. A later fatal decoder error
leaves no earlier data writes. Writer failures or cancellation during the final flush can
still leave some documents written; re-running the import converges because ids are stable.
The shared ZIP validator also rejects encoded separators, absolute/drive paths, decoded
traversal segments and control characters before adapter dispatch.
This applies to Google Takeout too: a Takeout file whose name contains a literal `%2f` or
`%5c` is now skipped as `invalid-entry`. Undecodable escapes such as `100%ab.txt` remain
accepted, and paths may have 16 components below `Takeout/`.

## Connect your Levoit purifiers

VeSync (`vesync`, **Levoit (VeSync)**) is **CLI only**. It uses the unofficial
account API at `https://smartapi.vesync.com`, following pyvesync request shapes;
there is no OAuth or browser CORS support. Use your own VeSync account. The adapter
only lists devices and reads purifier status; it sends no device-control commands.
Core 300S/400S/600S, Vital 100S/200S (including LAP model identifiers) and the older
LV-PUR131S are supported conservatively. Other devices are skipped. Provider changes,
regional accounts or extra login challenges can prevent login; there is no bypass.
Synthetic fixtures test these shapes; live compatibility awaits an owner-account trial.

First configure the Node CLI's owner-held 0600 Pod client-credentials file as above.
No `connectors.vesync` OAuth configuration is needed. From the workspace:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/solid-environment... run build
pnpm --filter @jeswr/pod-connectors run build
node packages/pod-connectors/dist/node/bin.js import vesync
node packages/pod-connectors/dist/node/bin.js import vesync --room "Living room"
node packages/pod-connectors/dist/node/bin.js import vesync --watch 10
# With the installed bin: pod-connectors import vesync --watch --room "Living room"
```

Email and password prompts both hide input and require a TTY. Alternatively supply
`VESYNC_EMAIL` and `VESYNC_PASSWORD` through your environment's secret injection;
never put passwords in command arguments or the JSON config. Only the Node VeSync
credential reader reads these variables, deletes them from `process.env` (so child
processes do not inherit them; the operating system's initial process environment,
such as `/proc/<pid>/environ`, still holds them for the process lifetime and any
process running as the same user can read it), hashes the password immediately with the API-required MD5 and drops the
plaintext reference. JavaScript strings cannot be securely erased from memory. The
hash, email, account ID and session token stay in memory; they never enter the pod,
run reports or diagnostics. Pod credentials use their separate existing transport.
For long-running `--watch` processes, prefer the hidden prompt: an environment
variable leaves the plaintext password readable through `/proc` for days.
The prompt enters raw mode before printing its label and pauses standard input
afterwards, so a one-shot import exits when it finishes.

Omit `--watch` for one reading per supported purifier now. Bare `--watch` means ten
minutes; `--watch <minutes>` accepts 5–1440 minutes. Polling is sequential until
SIGINT/SIGTERM. HTTP 429/5xx get three attempts with jittered exponential delays;
watch failures back off from the chosen interval toward one hour, with jitter and a
five-minute floor. Success resets the interval. HTTP 401 and token-expiry codes
`-11000022`/`-11000021` trigger at most one re-login per request. Only an explicit
login rejection (a non-zero login code, or HTTP 401) is a VeSync authentication
failure; network faults, timeouts and malformed login answers (a success code without
a session token or account ID) are retryable.

Watch mode classifies each failure by cause, wherever it happens (VeSync, Pod writes,
or the state checkpoint reread and writes), and prints which side failed:

- Retried with backoff: VeSync transport, timeout or answer faults (an unexpected
  non-zero VeSync code also drops the session, so the next cycle logs in afresh);
  network faults; Pod HTTP 5xx, 408, 412 (another writer won) and 429 (rate limited); transient
  checkpoint reads and writes.
- Stop the command: a VeSync login rejection and Pod HTTP 401/403 (exit 3); a Pod
  without strong ETags, other Pod 4xx refusals (including 409), structural checkpoint problems
  (no unambiguous ACL, missing ETag, corrupt state) and invalid device lists (exit 1);
  configuration errors (exit 2).

A one-shot import reports the same category. Exit codes: 0 success, 1 import or
checkpoint failure, 2 configuration, 3 authentication (VeSync or Pod), 130 cancellation.

Each sensor has metadata (Levoit, device model and label), a room FeatureOfInterest,
and UTC day observations under
`integrations/vesync/environment/vesync-<hmac>/`. The slug is an HMAC-SHA-256 of
the cid (uuid fallback) keyed by the connector's environment container URL, so it is
stable within one pod (re-imports stay idempotent) but differs between pods, and raw
cid/uuid/MAC never appear in pod IRIs. Room defaults to the purifier's
name. A single `--room <label>` applies to every purifier. To assign separate rooms,
use repeated `--room 'vesync-<64 hex>=Bedroom'` options, using the sensor slugs
visible in the pod. The library also accepts a `room` map keyed by these slugs.

Status keys follow pyvesync's device classes. Core models (bypassV2) read
`air_quality_value` (PM2.5), `air_quality` (an air quality level), `level`
(fan) and `filter_life`; Vital models read `PM25`, `AQLevel`, `fanSpeedLevel` and
`filterLifePercent`; the LV-PUR131S detail route is addressed by uuid and reads its
top-level `level` and `filterLife.percent` (its text air quality is omitted). Core
200S models have no air sensor, so only fan and filter readings are recorded. A
bypassV2 answer whose nested device code is non-zero records no readings.
PM2.5 uses QUDT MicroGM-PER-M3, numeric air quality indices and fan levels use
UNITLESS, and filter life uses PERCENT. Fan/filter observations concern the purifier;
air measurements concern the room. The Core `air_quality` and Vital `AQLevel` values
are Levoit's categorical 1–4 levels (1 is best), not a 0–500 AQI; they are stored
as `AirQualityIndex` (UNITLESS) because the environment model has no scale or method
annotation yet, so never chart them against another device's index. Device-specific index scales are preserved;
text ratings, modes, booleans and missing/invalid numeric fields are omitted.
Observations have stable minute/property identities, so repeats within the same
minute update those readings. Later minutes append with read-modify-write and a
strong If-Match ETag (create-only when absent); conflicts fail for a later retry.
Sensor/Observation/FeatureOfInterest classes register through the existing Type Index.

Limits: 1 MiB per source response, 8 MiB accepted response data and 51 adapter
requests per run, 50 listed devices, 200 observations per run, 30-second signals per
source attempt and Pod request, and a 3-minute deadline per adapter source call (a lazy
login, bounded retries and one renewal). An account listing more than 50 devices fails
the run rather than importing a partial list (reading the first 50 is a follow-up). Day documents respect solid-environment's 2000-root,
50000-quad and 8 MiB Turtle limits, reserving space for provenance. Full/over-budget day documents
are logged with fixed text and skipped. Each poll rereads the day; there is no
provider cursor or deletion sweep. Polling retains the latest 32 run summaries in
`_provenance.ttl`; older observation provenance links can outlive their summary.
Sensor and room documents are rewritten on every poll (new provenance and ETag);
skipping unchanged rewrites is a follow-up.

Library hosts use `createVeSyncAdapter({ room, now? })` from `./adapters/vesync` and
`createVeSyncSourceAuth({ credentials: { email, passwordHash }, transport, signal? })`
from `./node`, then pass that source port to `runImport`. The Node entry also exports
`hashVeSyncPassword` and `readVeSyncCredentials`; `CliOptions.vesyncCredentials` lets
hosts inject already-hashed credentials. `now`, auth `sleep` and `random` are fixture
seams. Catalogue metadata adds `cliOnly` and the `cli-only` status; show its requirements
as terminal instructions. `NormalisedDoc.requirePrecondition` opts into strong-ETag
checks, and `IntegrationAdapter.maxRunActivities` opts into bounded summaries (1–1000).
The shared `readJson` helper accepts an optional final AbortSignal after its RunBudget,
cancels stalled readers, and releases reader locks on completion or failure.

## Activity files (CON-A6)

`./adapters/activity-files` exports `activityFilesAdapter` and
`createActivityFilesAdapter(limits?)`. The Tier C `activity-files` catalog entry accepts
GPX 1.0/1.1, TCX and FIT, individually or inside a ZIP. Detection uses the FIT `.FIT`
header signature or XML root, regardless of filename. Select activity exports from
Strava, Garmin, Wahoo, Coros or Apple Health; no provider API or export URL is accessed.
Native File/Blob `stream()` and `slice()` support archives; text-only ports support XML.

Each activity has a document under `activities/<sha256>.ttl`, with the existing
ExerciseAction (Health) or TravelAction (Mobility) model. It includes available sport,
start/end, elapsed duration, distance, calories, creator/device and typed
additionalProperty metrics for elevation gain and average/maximum heart rate. The
health document uses the existing HealthRecord sector bridge; the current federation
has no sports workout equivalent, so no new sector terms are invented.

A document-local GeoShape track stores a sampled `schema:line` and compact JSON in
`schema:text`. Sample tuples are `[latitude, longitude, epochMilliseconds, altitudeMetres,
heartRateBpm, cadence, temperatureCelsius, distanceMetres, speedMetresPerSecond, powerWatts,
segment]`, with null for absent values. Sampling retains endpoints and at most 2,000
points. Segment boundaries prevent distance/elevation calculations across GPX gaps.
Original bytes are stored at most once per file, and only when an activity links them,
as create-only `activities/<file-sha256>.<format>` resources (25 MiB binary cap). Each
file's PROV origin is the hash-only `urn:sha256:<sha256(content hash, file name)>`; the
file name appears only as the original's `schema:name` (truncated to 256 characters) beside
its content-hash `schema:identifier`. When the bytes exceed the cap, the origin IRI itself
carries that name and identifier.

IDs hash start time, normalized sport and device serial (file hash when unavailable).
A bounded per-second index deduplicates later exports of the same sport when both
start time and elapsed duration differ by at most two seconds, including across second
boundaries. Moving time is not substituted for elapsed time: TCX elapsed duration is the
trackpoint time span, else the last lap's StartTime plus its TotalTimeSeconds minus the
first lap's StartTime. TCX TotalTimeSeconds is timer time and is not stored. Durations
outside 1 second to 7 days are dropped with the end time (the activity is kept); an
activity starting or ending outside 1970-01-01 to 2100-01-01 is skipped as invalid. A
failure while mapping one activity skips it (`activity-import-failed`); Pod I/O failures
and cancellation still fail the run. Complete imports retain
prior original links and optional metrics; truncated imports never become fuzzy-match
candidates. Unknown/missing sport is kept conservative; no fuzzy match occurs without
start and duration. Imports add/update activities, never delete absent workouts, and
file imports have no incremental cursor. The shared runner retains state on failure.

Hard caps: 64 MiB per file, 512 MiB compressed archive size and total inflation, 1,000 activities, 100,000
records per activity, 1,000,000 points and 2,000,000 parser events/FIT messages per run.
XML scanning also charges one parser event per 512 characters, including comments and
attribute text. At most 200,000 track samples stay retained per file; beyond that the
current activity is truncated and the rest of the file is not parsed.
XML tokens cap at 64 Ki characters and nesting at 64; DTDs and CDATA are refused.
The Takeout ZIP reader also enforces its structural, CRC, entry-count and path bounds.
Files are byte-capped and validated before their activities are written; FIT verifies
header/file CRCs and message boundaries. Original bytes are retained within the cap for
hashing and binary storage; XML parsing itself uses bounded streamed tokens, without a DOM.
Byte-overflow files are skipped; record/message/activity overflows import only a bounded
prefix. Diagnostics surface in `report.warnings`, alongside malformed-file `skipped` counts.
Dedup buckets and original-file histories cap at 32 entries each. Host limits may only
lower the hard caps. The original file remains the source for full-resolution telemetry.

## Encrypted refresh vault (CON-A1)

```ts
import {
  ConnectorTokenVault, importVaultKey,
} from '@jeswr/pod-connectors/vault';
import { FileVaultStore } from '@jeswr/pod-connectors/node';
import { getOAuthToken, createOAuthSourceAuth } from '@jeswr/pod-connectors/oauth';

// Node host: exact base64 from CONNECTOR_VAULT_KEY or a private key file.
const vault = new ConnectorTokenVault(await importVaultKey(encodedKey), new FileVaultStore(directory));
const options = { vault, account: 'work' };
const token = await getOAuthToken(adapter.metadata.id, adapter.oauth, sourceFetch, options);
// If undefined, use authorize/authorizeLoopback with the same vault/account options.
const sourceAuth = createOAuthSourceAuth(adapter, adapter.oauth, sourceFetch, { ...options, token });
// On explicit disconnect:
await sourceAuth.disconnect();
```

A browser host imports only the browser-safe entry:

```ts
import { ConnectorTokenVault, IndexedDbVaultStore } from '@jeswr/pod-connectors/vault';

// An owner-specific DB holds ciphertexts and its non-extractable CryptoKey.
const store = new IndexedDbVaultStore('connector-vault-owner-label');
const browserVault = new ConnectorTokenVault(await store.getOrCreateKey(), store);
// Or keep only a passphrase-wrapped key at rest (prompt the user; never store the passphrase).
const protectedStore = new IndexedDbVaultStore('connector-vault-protected-owner-label');
const protectedKey = await protectedStore.getOrCreateKey({ passphrase: userPassphrase });
```

**IndexedDB key boundary.** Without a passphrase the non-extractable key is stored in the same
database as the ciphertexts. Anyone with a copy of the browser profile, and any script running on
the same origin, can use that key and decrypt the refresh tokens; non-extractable only stops the
raw key bytes being exported. With `getOrCreateKey({ passphrase })` the database holds only the
key wrapped by AES-256-GCM under a PBKDF2-SHA-256 key (600,000 iterations, random 16-byte salt
stored beside it), so a copied profile is unusable without the passphrase. Same-origin script
running while the vault is unlocked can still use the returned key, and script that persists on
the origin (an injected or compromised dependency) can capture the passphrase at the next unlock.
Passphrases are 8 to 1,024 UTF-16 code units; strength is the host's responsibility. A copied
profile allows offline guessing at 600,000 PBKDF2 iterations per guess, so an 8-character minimum
is a floor, not a recommendation: prefer a long passphrase. A wrong passphrase, a tampered wrapped
key, or mixing passphrase and unprotected modes in one database raises the generic
`ConnectorVaultError`. A forgotten passphrase requires reauthorisation. To switch an existing
unprotected database to passphrase mode, delete the old database (its unprotected key and
ciphertexts stay usable otherwise) and reauthorise. Do not record the chosen mode or the
passphrase in localStorage, IndexedDB or any other browser storage.

`ConnectorTokenVault(key, store)` exposes `get({ connectorId, account })`, `put(key, record)`,
`delete(key)`, optional `withLock(key, fn)` and authenticated `list()` (keys only). The
constructor refuses an extractable CryptoKey with the generic error.
`put` replaces ciphertext without decrypting the old record, so a fresh login with a rotated
key can recover it. Refreshing an unreadable record raises `UnreadableCredentialError`, an
`IntegrationAuthError` subclass with `reason: 'reauthorise'`, so hosts may start login. Records
contain `refreshToken`, epoch-ms `obtainedAt`, optional `scope`, `tokenType`, refresh-credential `expiresAt`, and `providerMeta`.
Access-token expiry stays in the live `TokenSet`. Unknown record fields are rejected.
Metadata is plain JSON with credential-shaped fields refused; keep secrets out of metadata
and account labels. Connector ids are 1–64 lowercase ASCII letters/digits/hyphens, starting
with a letter/digit; account labels are 1–256 well-formed UTF-16 code units without surrounding
whitespace or ASCII controls. Refresh tokens are at most 16,384 code units, scope 4,096 and
token type 64. Metadata is capped at 4 KiB UTF-8, 256 nodes and depth 8; plaintext at 32 KiB
UTF-8, sealed input at 64 KiB characters and each store/list at 1,000 records. Bounds fail closed.

WebCrypto AES-256-GCM uses fresh random 12-byte IVs, 128-bit tags and canonical
`JSON.stringify([1, connectorId, account])` AAD. The sealed string is
`1.<canonical-unpadded-base64url-IV>.<canonical-unpadded-base64url-ciphertext-and-tag>`.
Parse, validation, authentication and storage failures all raise `ConnectorVaultError`
with the same constant message and no underlying cause. Key helpers never read environment;
only the Node CLI host reads `CONNECTOR_VAULT_KEY`. Imported keys and
`generateBrowserVaultKey()` are non-extractable. Keep the original Node key safe: losing it
requires reauthorisation. Hosts reading a key file must keep it private and pass its exact
canonical base64 contents to `importVaultKey`, without whitespace/newline trimming.

`VaultStore` receives canonical JSON `[connectorId, account]` ids and ciphertext strings.
`MemoryVaultStore` is a bounded single-process fixture with a per-key mutex.
`FileVaultStore` is exported only from `./node`: SHA-256 filenames, 0700 directories, 0600 files, owner checks, symlink and
hardlink refusal, bounded descriptor reads, exclusive temporary files, file fsync, atomic
rename and directory fsync. Existing group/world-accessible stores are refused, not repaired.
A record file whose mode was loosened is refused by `get` and `put` and skipped by `list`, but
`delete` still unlinks any regular record file owned by the current user (never a symlink or
another user's file), so disconnect keeps working.
Ancestor directories must be controlled by the host user or root; shared writable ancestors
require the sticky bit. Construction resolves ancestor aliases with `realpath` once and
checks the canonical path; a symlinked final directory or record is still refused.
These ancestor checks prevent another user from replacing the private store's path.
`FileVaultStore` requires a POSIX filesystem and throws at construction on Windows.
It removes its own regular, current-uid temp files older than ten minutes on construction
and before list/put budget checks; temp files never consume the name budget. Enumeration
has a separate 10,000-entry work cap. Refreshes use per-record exclusive 0600 lock files;
stale locks break after 60 seconds by mtime, active owners renew mtime, and release runs in
`finally`. A waiter takes over a stale lock by renaming it to `<lock>.<uuid>.stale` and deletes
that file only if its device and inode match the lock it judged stale. Otherwise the file is
another owner's live lock: it is restored with a non-clobbering `link` back to the lock name and
the renamed name is removed; if a third lock already holds that name, the renamed file is left
to age out (its owner's release then sees a mismatch). Either way the waiter retries.
Leftover `.stale` files age out like temp files. A newly created lock that fails its safety check is unlinked, after the same
device/inode comparison, before failing. A failed release never replaces the callback's value
or error; the unreleased lock goes stale. Contention waits at most 65 seconds before failing
closed.
`IndexedDbVaultStore.getOrCreateKey()` elects one key in a read/write transaction and stores
it via structured clone in the same database as records; writes resolve only after commit.
Version changes close and clear the cached handle; the next call reopens.
Account locks use `navigator.locks.request` where available, otherwise a shared in-process
mutex (cross-tab ownership then requires host coordination). Clearing that database removes
both records and key. Hosts retain their origin/script security responsibilities (see the key
boundary above).

Pass `{ vault, account, signal? }` as the final argument to code exchange or refresh helpers.
`authorize` takes these options as its fourth argument, or as its fifth after a custom
same-origin callback page. `authorizeLoopback` accepts them in its options. `getOAuthToken` returns a
live supplied token, refreshes saved credentials, or returns undefined for interactive login.
With a vault, a missing record means disconnected: an in-memory refresh credential raises
`reauthorise` instead of reviving the account (vault-less sessions keep their in-memory
credential). Undefined is returned only when neither a record nor an in-memory credential exists.
Refresh holds the optional store lock across reread, token exchange and put/delete, using
any newer saved refresh token before sending. On `invalid_grant`, compare with the sent
token before deleting; if a newer token exists, retry once with it and never loop. A rejected
current credential raises `IntegrationAuthError` with `reason: 'reauthorise'`; other failures
retain it. Token requests (code exchange and refresh) never use the caller's signal: once sent
they run on a private controller with a 30-second timeout (`TOKEN_REQUEST_TIMEOUT_MS`), so a
cancellation cannot cut off a response carrying a rotated credential. A caller abort before
sending prevents the request; one during the exchange is honored after the response is
validated and persisted, with a generic `AbortError`. A code exchange that returns no refresh
token deletes any stored record for that `{ connectorId, account }`, so another provider account
cannot silently reuse the previous login's credential. `createOAuthSourceAuth` restores lazily,
refreshes expired tokens, shares concurrent refreshes and retries a GET once after 401.
`disconnect()` waits for pending refresh before deleting so it cannot repopulate the vault.
When the OAuth config has a `revocationEndpoint` (RFC 7009), disconnect first POSTs the stored
and session refresh tokens there (`token_type_hint=refresh_token`, same client authentication
and private-controller timeout rule, not sent once cancelled), ignoring every failure, then
deletes locally. The Google configurations declare `https://oauth2.googleapis.com/revoke`.
Revoking at Google removes the whole grant for that OAuth client, so disconnecting one Google
connector also signs out every other Google connector that shares the client ID; those need
reauthorising. A disconnect cancelled part-way can revoke one of the two tokens and not the other,
and still deletes the local record; remove any remaining access in the provider's account
settings (for Google, the account's third-party access page).
Other providers have no RFC 7009 endpoint configured: revoke the app's access in the provider's
account settings.
The built-in stores provide account locks for the shared engine, including CLI cron runs
using the file store. Custom stores without `withLock` require hosts to serialize mutations.
`createSpotifySourceAuth` throws when given a vault: vault hosts must use
`createOAuthSourceAuth` so every refresh follows the shared persistence contract.
Tokens never enter the pod, localStorage, sessionStorage or cookies.
