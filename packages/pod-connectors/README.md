<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
# @jeswr/pod-connectors

> Experimental — AI-agent-generated. Security-critical; private until conformance is gate-green.

Source API and export-file adapters extracted with history from Pod Manager. The default
catalog is unconfigured and uses recorded fixtures for demos. No environment variables are
read by this package: the host injects public OAuth client ids and token proxy URLs.

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
Pass the run's `signal` to the writer to cancel every storage operation inside a port.
Hosts own cache policy; the Node transport forces revalidation.

Live imports take `sourceAuth: { fetch: authenticatedSourceFetch }`. The optional
`createSourceAuth(id, adapter, token, sourceFetch)` helper adds bearer and adapter headers.
The helper binds credentials to an HTTPS-only origin allowlist (default: static fixture route origins)
and refuses redirects; pass a fifth argument to supply additional API origins explicitly.
Hosts must capture a pristine `sourceFetch` before initializing Solid authentication and
pass it to `authorize(id, config, sourceFetch)` as well as `createSourceAuth`. Pass the
auth manager's separate `podFetch` to `createFetchPodWriter`; never use the patched global
fetch for source API requests or token exchange. Tokens stay in memory. A `PodWriter` binds a
connector container, resolves and reads slugs, writes RDF with `{ ifMatch }` or
`{ ifNoneMatch: '*' }`, and registers Type Index entries. The fetch-backed implementation
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
- `./oauth`: browser PKCE helpers and popup flow (only `authorize` touches `window`).
- `./node`: Node CLI, pod-auth client-credentials Pod fetch, loopback source PKCE and state store.
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

## Node CLI

Build the package and run `pod-connectors import spotify`, or
`node packages/pod-connectors/dist/node/bin.js import spotify` from the workspace.
`import netflix --file ./NetflixViewingHistory.csv` uses the file runner. Add the bare
`--since` flag to an API import to resume its stored cursor; omission starts a full import.
File imports reject `--since`. `--help` prints usage. Streaming adapters receive the stat
size and `stream()`/`slice()` backed by bounded filesystem read streams; the CLI never
loads their entire upload. `text()` remains capped at 64 MiB. The whole-upload size limit
applies only to adapters without `streaming: true`.

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
proxy mode is preserved. These secrets and all session/source tokens remain in memory.
Direct exchanges request JSON token responses, including GitHub. The provider's `tokenRequest`
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
memory through this factory. An explicit `options.sourceAuth` bypasses login and the factory.

The CLI stores `<podRoot>integrations/<id>/state.json`, including failed outcomes while
retaining the last successful checkpoint. Before accessing JSON, it discovers the resource's
`rel="acl"` link and writes a WAC ACL granting only the owner WebID Read, Write and Control.
The ACL must be in the same connector container. Missing ACL discovery or rejected ACL
writes fail closed; ACP/LWS state protection belongs to later storage integration.
Conditional JSON PUTs reject stale ETags and concurrent creates. Once the CLI is cancelled it
sends no further Pod or source request, so a cancelled run leaves the checkpoint unchanged. State persistence failures
fail the command even if import documents were already written; deterministic slugs allow retry.

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
such an unrecorded activity as a cancelled, incomplete run; the next run that rewrites those
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
CSV headers are parsed and normalised once per file, including bank column
aliases, and are limited to 1,024 columns and 65,536 characters.
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
The catalog has 32 entries: eight Tier A, fourteen Tier B, and ten Tier C.

A full import captures `changes/startPageToken` before paginating `files.list`; later
imports replay `changes.list` and persist its final `newStartPageToken`. HTTP 404/410 from
the changes feed triggers one full resync. Full snapshots reconcile missing local files
only after a complete, valid listing. List and changes pages require object envelopes with
`files`/`changes` arrays and nonempty string pagination tokens when present; malformed pages
fail before reconciliation or checkpoint advancement. One shared `RunBudget` caps source
requests (including downloads), listed items, and cumulative JSON response bytes across pagination
and any full-resync fallback (512 MiB JSON data budget by default).
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
for `Retry-After` (seconds or HTTP date), with at most three retries; aborting the run's
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

GitHub, Strava and Reddit create one shared-core `RunBudget` per import. Hosts can inject
`{ maxRequests, maxItems, maxBytes? }` through `createGithubAdapter(limits)`,
`createStravaAdapter(limits)` or `createRedditAdapter(limits)` from their adapter entry points;
the existing singleton exports use the shared defaults: 20,000 requests, 2,000,000 items and
512 MiB of cumulative response bytes. Omitting `maxBytes` retains that default byte limit.
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
