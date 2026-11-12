---
name: suite-sdk
description: Use when working on @jeswr/suite-sdk registration, notifications, server/local search, LocalIndex feeders, useSearch, useNotify, useInbox integration with PodAuthProvider, or pod-backed preferences and offline preference replay.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- // AUTHORED-BY Codex GPT-6 -->

# @jeswr/suite-sdk

The root exposes SDK-APP-05's `useRegistration()` and SDK-APP-07's `useNotify()`, `useInbox()` and
notification builders. SDK-APP-09's search facade lives at `@jeswr/suite-sdk/search`; SDK-APP-11's
pod-backed preferences live at `@jeswr/suite-sdk/preferences`. Application shell wiring is separate.
Do not infer that the other planned SDK facade APIs are implemented.

## Offline (`./offline`)

Also re-export `createPageCache`, `PageCache`, `PageCacheOptions`, `purgeForWebId`
and `cacheProvenance` from solid-offline. These are thin exports: cache policy stays
in solid-offline. Native consumers supply their existing live session fence, create/start
after commit, and purge on account switch and every sign-out path. Web keeps its worker.

Re-export `createOutbox`, `withOutbox`, `mergeRdf`, all outbox types and `useOfflineStatus`
from solid-offline. `useOutbox(outbox: Outbox | null)` returns
`{ pending, conflicts, retry, retryAll, resolve, replay }`. Cache the combined snapshot between
events: solid-offline's getters return fresh arrays. Subscribe to both `change` and `conflict`,
refresh after subscription to cover hydration/render races, and unsubscribe on replacement or
unmount. Server rendering and null use empty snapshots; null actions are inert. Actions remain
stable until the outbox changes and propagate failures. `retryAll()` delegates to `retry()`.

The caller owns the per-WebID outbox and authenticated StorageClient. Never create another auth
path here. Replay only during that account's active session, cancel on sign-out/switch, and
preserve unsent writes (close releases listeners; purge is explicit). Replay after resolving a
conflict to resume held operations. Read `packages/solid-offline/SKILL.md` for queue opt-in,
conflict-copy and merge behavior. Keep this hook's tests at 100% coverage.

Read `packages/pod-access/SKILL.md` for notification API details. Use `PodAuthProvider` from
`@jeswr/pod-auth/react`; never create another auth session or modify credentials in this facade.
The notifier cache belongs to the current identity and must reset on lifecycle/account changes.
Recipient protocol hints describe the recipient, independently of the current identity's protocol.
Preserve the explicit DNS-pinning requirement for Node transports and all redirect refusals.

## Domain intents (`./offline`)

`createIntentChannel<T>({ tag, destination, matches, decode, deliver, maxBytes? })`
puts small JSON domain intents on guarded outbox writes. Tags match
`/^[a-z][a-z0-9.-]{0,63}$/`; use a versioned name such as `chat.message-v1`.
`submit(session.storage, intent)` validates the JSON round trip before storing bytes and
returns the queueing write result. The default encoded limit is 64 KiB.
`await channel.enqueue(outbox, intent)` validates identically and persists directly without an
online attempt. Use it when the caller must keep an intent behind retained prerequisites;
replay, blocking and conflicts remain owned by the outbox. It returns after persistence,
not delivery. Online sends without retained prerequisites use `submit`. The destination
must belong to the channel's `matches(url)` scope. A delegate performs the domain mutation;
intent bytes are never delivered as a raw PUT. The write signature's required `ifMatch`
is a placeholder; the domain delegate obtains the actual validator.

Call `channel.register(session)` in a committed effect keyed on the shell outbox session,
only after `session.storage` becomes non-null. It installs the replay delegate and a guard
policy requiring the tag at matching destinations (including named creates), and returns
idempotent cleanup. If delegate
registration fails, the policy is rolled back. Re-register on session replacement. Missing
delegates keep queued items blocked. Delivery rejects other operations/content types,
invalid UTF-8/JSON/schema, oversized bodies and recomputed destination mismatches before
calling `deliver(intent, { fetch, webId, storage, signal })`. Use that session fetch or raw
storage and respect the signal. Decoder errors are replaced with content-free messages.

`await channel.pending(outbox)` hydrates and decodes items with that tag, returning each
item's ID, intent, status, blocking reason and error. Other tags are skipped. Invalid bodies
or bindings return an error row without an intent (`PendingIntent<T>`), allowing callers
to report corrupt items without throwing or inventing a value of `T`.

## Inbox reading

`useInbox({ clock?, maxItems?, pinningFetch? })` returns `{ status, items, error, refresh }`.
It loads the current WebID automatically; no WebID is idle, missing/LWS inboxes are ready
and empty. refresh is stable within a session, resolves ordinary failures into error state,
and rejects retained/stale calls with `Notification session changed`. `InboxNotification`
and `notificationKind` are re-exported; classification lives in pod-access.

Use the same committed-render fence as useNotify, including the pinned transport. Never
activate authority during render. Reset items immediately on identity changes (including
same-account logout/login), abort all reads on replacement/unmount, and discard superseded
refresh settlements even if transports ignore cancellation. Do not add mark-read/delete.
Keep lifecycle, error and cancellation tests at 100% coverage.

## Search (`./search`)

`createSearch({ capabilities: storage, fetch: auth.fetch, local: createLocalSearch(index) })`
accepts a StorageClient's public `root` and `features` fields as capabilities. No discovery or
auth session is created here. Only `serverSearch.state === "available"` selects the advertised
ACQ-profiled endpoint; missing endpoints are errors. Scope endpoints to the storage origin
(services can be outside the root path), reuse guarded-fetch, and refuse every redirect.
Server failures propagate; do not silently replace permission/transport errors with local data.

`search(query, { signal? })` returns `{ source, results, next? }`. Queries support `text`,
`types`, `within`, `orderBy`, `limit` (1–1000, default 50), and opaque offset `cursor`.
`recent({ within?, limit? }, options?)` searches without text, sorted by modified time.
`buildSearchQuery` is the one shared named-graph SELECT: escape string literals, validate all
HTTP(S) IRIs, group by subject, and keep deterministic ordering and lookahead paging identical
on both paths. Container prefixes gain a trailing slash. Parent URLs use path containment;
they are not LWS logical `up` links. Pagination reflects the current index and is not a snapshot.

`createSearchFeeder(index).resource(url, dataset)` is the plain async dataset callback for
cached RDF; `.container(url, entries)` replaces a separate synthetic graph from a **complete**
successful StorageClient listing. Build synthetic quads through ldp-container's typed
`buildListingDataset` accessors, preserving the shared n3 terms. Include decoded member names
and listing metadata so binary names and recents work without fetching binary bytes. Do not pass an incomplete page
as a complete listing. `containerSearchDataset(url, entries)` exposes the same RDF/JS builder.
The current solid-offline `onVisit` is observability only and has no dataset; the page's cache
pipeline calls the feeder after parsing, and calls `.container` after collecting all listAll
entries. This facade does not modify the warmer or subscribe to notifications.

The caller owns index lifecycle: partition persistence by WebID/storage, dispose and purge
on logout/account switch, and refeed/remove graphs after changes. Local results cover only
fed cached data and are not authoritative. `LocalIndex.put` replaces the resource graph.
Local WASM SELECT has no interrupt API: AbortSignal rejects delivery after completion.

`useSearch(queryOrNull, client.search)` debounces 250 ms and returns `{ status, page, error }`.
Null is idle; a non-null query is loading during debounce. Keep the callable stable. Query
values may be inline objects. Abort on replacement/unmount and ignore late success or failure,
even when the supplied implementation ignores its signal. Do not add app shell integration here.

Run `lint`, dependency-first `build`, `typecheck` and `test`; coverage thresholds are 100%.

## Registration (`SDK-APP-05`)

`useRegistration({ accountApi, podHost?, fetch?, allowInsecureLoopback? })` delegates the entire
`@jeswr/pod-auth/registration` API to the current PodAuthProvider core. With no options it uses
accountApi:null. Read pod-auth's registration contract for preview, async availability/username
checks, password-only methods, per-call signal/onStep, Identity and typed partial progress.
The optional fetch is pristine, not the provider's credentialed fetch; only profile writes use
that authenticated fetch. The hook does not own credentials or another auth session.

Activate actions only in committed layout effects. Retained actions and late probe results must
fail after session/lifecycle/options changes or unmount, including logout while already anonymous.
Abort registration work and fence every dispatch/settlement. Its own matching login is an expected
transition for that one run, allowing the protected profile write and Identity result, while old
retained actions still lose authority. Logout, expiry, restore or an unrelated login abort the run.
Keep StrictMode/suspended-render, cancellation and own-login tests at 100% coverage.

## Preferences (`./preferences`, SDK-APP-11)

`const usePreferences = createPreferences({ storage, typeIndex, webId, profile?, ensureOwnerOnly? })`
returns a callable hook with `flush(): Promise<void>` and `dispose(): void`.
`usePreferences<T>(key, schema, defaultValue)` returns `{ value, set, loading, pending, error }`.
`schema` is structural `{ parse(unknown): T }`, compatible with zod; no zod dependency.
The default is required. Values/defaults must be JSON; sets reject lossy values and payloads over
64 KiB UTF-8 with `PreferencesError` (`invalid-json`, `too-large`). Keys match
`[a-z0-9][a-z0-9.-]{0,63}`; camelCase names such as `recentSearches` must become `recentsearches`.
Schema/JSON read failures return the default and warn once per key per store.

Create one factory per authenticated session using the existing StorageClient and TypeIndex;
create no auth session or implicit discovery client. Dispose it on logout, identity/fetch/client
replacement, and same-account re-login; retained setters reject `session-changed`.
Hook effects activate I/O only after commit; key/account changes fence retained setters, and
disposal aborts/fences reads and writes even when an underlying transport ignores cancellation.
Disposing a store is permanent. It leaves its WebID-scoped durable pending values for a later
session of that same WebID. Memory, database keys/envelopes and `suite-prefs` channel messages
include both WebID and storage root. Foreign/malformed messages are ignored.

Read `pim:preferencesFile` on the exact WebID subject and use its directory. Otherwise resolve
`pim:ConfigurationFile` through the Type Index, or create `settings` and register the returned
container URL. Use `suite/<encoded-key>.json` on Solid. LWS identifiers are server-assigned:
creation uses type links for ConfigurationFile, the suite container
(`https://jeswr.org/ns/suite/preferences`), and each key (that IRI plus `/` and the encoded key).
Listings rediscover the actual returned suite/file URLs; never predict LWS identifiers from Slugs.
Ambiguous locations and out-of-storage pointers fail closed. Pass `profile` (a parsed
StorageClient `RdfReadResult`) when the WebID profile is outside the selected storage. Missing or
non-RDF native LWS profiles have no RDF preference pointer; other profile errors propagate.

The public SDK has no profile-pointer reader or exported owner-only container provisioner.
Small local equivalents read the parsed profile and use pod-access's `ownerPolicy` and `writeWac`
for WAC. Provision the suite before any JSON access: an owner-only ACL is created only when the
container has no ACL of its own; an existing ACL (for example one the owner changed to share
settings) is never rewritten. Use only the advertised ACL URL and conditional
storage operations, never guessed ACL suffixes. For ACP/LWS, pass an idempotent
`ensureOwnerOnly(url, signal)` that provisions/verifies private container and descendant access
using the deployment's trusted access model. Unsupported defaults refuse before JSON writes.
Only a successfully provisioned suite is reused within the store.

Files use `application/json`, observed ETags for updates, exact-name `create` (If-None-Match: *)
on Solid and typed POST creation on LWS. One write runs at a time; concurrent setters coalesce
to the latest whole value per key. On 412 (or a Solid create-name conflict), re-read and retry
once with the local whole value winning; another conflict sets error and retains pending data.
`set(next | updater)` optimistically changes memory, persists pending JSON in IndexedDB, and
attempts delivery. Validation/session errors reject; persistence/transport errors populate
`error` and keep `pending`. Awaiting an offline set means it is queued, not delivered.

SDK-APP-08's outbox is pending: the internal `ReplayQueue` in `src/preferences/cache.ts` isolates
the temporary durable latest-per-key queue. Replay runs on the next committed mount/explicit
flush and on `online`, ordered by each key's latest set sequence. Acknowledgements compare tokens
and cannot clear a newer pending value; stale persistence cannot replace a newer record.
IndexedDB absence falls back to memory (no restart durability). BroadcastChannel absence disables
tab updates. Test preferences source with real memory Solid/LWS operations and fake-indexeddb;
keep the explicit `src/preferences/**` 100% statement/branch/function/line threshold.

Public API changes must update this skill and README together.
