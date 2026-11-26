<!-- // AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/suite-sdk

> **Experimental — AI-agent-generated.** Private account, registration, notification, search, preferences and offline facades.

Mount `PodAuthProvider` from `@jeswr/pod-auth/react`, then use the provider's authenticated
fetch and current actor through the hook:

```ts
import { assignmentAnnounce, useNotify } from '@jeswr/suite-sdk';

const notify = useNotify();
const result = await notify(assignee, assignmentAnnounce(task, tracker, name, title));
```

`notify` is a stable callable until the identity, fetch, or explicit options change. The hook
resets its discovery cache on session changes. Delivery failures return `delivered: false`.
Without a session WebID it returns an `unauthenticated` failure without sending. Explicit activity actors
must equal the authenticated session WebID; a mismatch returns `invalid-actor`.
`useNotify({ recipientProtocol })` accepts a resolver for known LWS recipients; do not infer
recipient protocol from the sender's identity. See [pod-access](../pod-access/README.md) for
the result shape, builders, cache behavior, and Node DNS-pinning requirements.

`useInbox({ clock?, maxItems?, pinningFetch? })` reads the current WebID's LDN inbox using
`usePodAuth()` and returns `{ status, items, error, refresh }`. It loads automatically;
`refresh(): Promise<void>` reloads now. Status is `idle` without a WebID, `loading` while
reading, then `ready` or `error`. Items are `InboxNotification[]`, newest first; ordinary
read failures populate `error` and clear items. Missing/LWS inboxes resolve ready and empty.
`notificationKind(item)` is also re-exported to classify the four builder shapes.

The reader and stable refresh function are recreated on identity/fetch/options changes,
including logout and same-account login. Account changes clear items immediately, and
replacement/unmount aborts profile, listing and member reads. Only committed sessions may
fetch; retained refreshes reject with `Notification session changed`. Refresh replacement
cancels prior listing work and ignores late settlements. Discovery/body/scope/concurrency
limits match [pod-access](../pod-access/README.md). No read-state writes are performed.

`./testing` re-exports `createNotify` for fixture-fetch tests. Run this package's `lint`, `build`,
`typecheck` and `test` scripts; tests enforce 100% coverage.

## PWA installation

Import `installPrompt` and `useInstallPrompt` from `@jeswr/suite-sdk/pwa`.
Start capture in a root provider effect with `useEffect(() => installPrompt.start(window), [])`.
In Settings, show an Install button for `status === 'available'`, disable it while `prompting`,
show “Use Share, then Add to Home Screen” for `ios`, and hide the row for `installed`.
`unavailable` means no browser prompt is available. Standalone mode includes iOS and
window controls overlay. No UI is injected by the SDK.

Call `installPrompt.install()` directly from the button's click handler. It returns
`'accepted' | 'dismissed' | null`, propagates browser errors, and consumes each browser
prompt once. A later browser event can enable installation again after dismissal or failure.
Capture survives Settings navigation, and root listeners are reference counted and cleaned
up after the last provider unmounts. SSR has a stable unavailable snapshot and no browser I/O.
`createInstallPromptStore()` creates an isolated store, accepted by `useInstallPrompt(store)`.

## Accounts (`SDK-APP-02`)

```tsx
import { createAccountManager } from '@jeswr/pod-auth/accounts';
import { AccountsProvider, useAccounts } from '@jeswr/suite-sdk';

const manager = createAccountManager(options);
await manager.restoreAll();
// Mount once around the application:
<AccountsProvider manager={manager}><App /></AccountsProvider>

// In a component:
const { accounts, active, switchTo, add, remove } = useAccounts();
await switchTo(accounts[0].webId); // local switch; no navigation or network
```

`useAccounts()` returns identity snapshots and the manager's stable actions. `AccountsProvider`
adopts the manager's current core through `PodAuthProvider` from `@jeswr/pod-auth/react`.
Existing `usePodAuth`, `useNotify`, `useInbox` and registration consumers then follow the active
identity and its bounded fetch. Replacing an account as the same WebID also replaces the provider's
core. With no active account the provider is unauthenticated; its login action adds an account.
The caller owns manager startup (`restoreAll`) and disposal. See [pod-auth's account contract](../pod-auth/README.md#multiple-accounts-accounts-sdk-app-02)
for cancellation, scoped removal, expiry and storage details.

A single account is just a manager with one account; no single-session fallback is needed.
Existing applications can continue using `PodAuthProvider` directly.

## Offline (`SDK-APP-08`)

The same entry re-exports `createPageCache`, `PageCache`, `PageCacheOptions`,
`purgeForWebId` and `cacheProvenance` for native session integration (MOB-P3e).
The caller supplies the bounded session fetch and live `usable()` fence, starts change
subscriptions after commit, and purges on account switch/logout. See the
[page cache contract](../solid-offline/README.md#native-page-cache-mob-p3e).

`@jeswr/suite-sdk/offline` re-exports `createOutbox`, `withOutbox`, `mergeRdf`, the outbox
types and `useOfflineStatus`. `useOutbox(outbox: Outbox | null)` returns
`{ pending, conflicts, retry, retryAll, resolve, replay }`. Its snapshots and actions remain
stable between changes; a null outbox is empty and its actions resolve without doing work.
The hook subscribes to both change and conflict events, including initial queue hydration.

Create an outbox per authenticated WebID and decorate that session's StorageClient with
`withOutbox(storage, outbox)`. Opt writes into persistence with `offline: 'queue'`; patch and
move remain unqueueable. `retry(id?)` retries failed items, `retryAll()` calls `retry()`,
`resolve(id, 'mine' | 'theirs' | 'both')` resolves a conflict, and `replay(storage, options?)`
uses the supplied authenticated client. Replay again after resolution to resume held writes.
The caller owns lifecycle: cancel replay when the session ends, close listeners and preserve
unsent changes on sign-out. Only explicit `purge()` discards the queue. See
[solid-offline](../solid-offline/SKILL.md) for durability, conflict and merge semantics.

## Search (`SDK-APP-09`)

```ts
import { createRdfEngine } from '@jeswr/rdf-engine/browser';
import { createLocalSearch, createSearch, createSearchFeeder, useSearch } from '@jeswr/suite-sdk/search';

// storage is the StorageClient from createPodClient; auth.fetch comes from pod-auth.
// Give each WebID/storage its own persistence database/key; configure the hosted WASM URL.
const engine = createRdfEngine({ wasmUrl });
const index = await engine.createIndex({ persist: accountScopedPersistence });
const feeder = createSearchFeeder(index);
const local = createLocalSearch(index);
const search = createSearch({ capabilities: storage, fetch: auth.fetch, local });

const page = await search.search({ text: 'report', within: [driveUrl], limit: 20 });
const next = page.next && await search.search({ text: 'report', within: [driveUrl], limit: 20, cursor: page.next });
const recent = await search.recent({ within: [driveUrl], limit: 10 });

// In a React component; keep search.search stable. Pass null to suspend the query.
const { status, page: found, error } = useSearch({ text }, search.search);
```

`SearchQuery` accepts `text?`, `types?: string[]`, `within?: string[]`,
`orderBy?: 'modified' | 'relevance'`, `limit?` (1–1000; default 50), and `cursor?`.
Types must be absolute HTTP(S) IRIs. Within filters are container URL prefixes, normalized to
a trailing slash, without queries or fragments. Text is matched case-insensitively against
`dct:title`, `rdfs:label`, `schema:name` (both HTTP/HTTPS), `wf:description` and `sioc:name`.
Relevance (default) puts exact matches first, then prefixes, then other matches, with modified
time and subject URL as tie breakers. Modified ordering is descending, with URL ties.
Multiple labels, types and graphs yield one row per subject; title/type/snippet/format use
lexical minima and modified uses the latest value.

`SearchPage` contains `source: 'server' | 'local'`, `results`, and optional `next`.
Each result has `url`, `title`, `parent`, and optional `type`, `snippet`, `modified: Date`,
`contentType`. Parent is the URL's containing path container, including for fragment subjects;
LWS logical containment may differ. Offset cursors are opaque and apply to an unchanged query.
Changes to the indexed data between pages can move results; pages are not snapshots.

Only an available `storage.features.serverSearch` selects its ACQ-profiled
`ssd:SparqlQueryService`. The facade posts the **same** `buildSearchQuery(query)` SELECT used
locally, via the injected authenticated fetch, with SPARQL Protocol content negotiation.
Endpoints must share the storage root's origin, even when their paths sit outside that root.
Credential-bearing endpoints and all redirects are refused using guarded-fetch. Unknown or
unavailable support chooses local; server errors propagate. Availability does not imply permission.

`search.search(query, { signal })` and `recent(query, { signal })` support cancellation.
Local SELECT cannot interrupt running WASM work, so cancellation discards its result.
`useSearch` debounces 250 ms, aborts replaced/unmounted requests, and ignores stale settlements.
It returns `idle` for null, `loading` during debounce/request, then `ready` or `error`.

Feed cached data without pulling binary bodies:

```ts
const cached = await storage.readRdf(resourceUrl);
await feeder.resource(cached.url, cached.dataset); // plain (url, dataset) callback

const entries = [];
for await (const entry of storage.listAll(driveUrl)) entries.push(entry);
await feeder.container(driveUrl, entries); // only after every page succeeds
```

Resources replace their own named graphs. Container feeds replace separate synthetic graphs
with `ldp:contains`, decoded filename `dct:title`, `dct:modified`, `stat:size`, `dct:format`,
and the listing's RDF types, built through `@jeswr/ldp-container`'s typed metadata accessors.
`containerSearchDataset(containerUrl, entries)` also exposes
the RDF/JS quads directly. A complete replacement removes old listing members while retaining
cached resource graphs; remove those separately with `index.remove(resourceUrl)` on deletion.

solid-offline's warmer currently exposes `onVisit` metadata without a dataset. Invoke
`feeder.resource` from the page's parsed-cache pipeline and `feeder.container` from completed
listings; the facade does not change the warmer. The caller owns refresh/invalidation and
must dispose the engine and purge persisted index data on logout/account switches. Local
results cover fed cached data only. Application shell wiring is a separate PR.

## Registration (`SDK-APP-05`)

```ts
import { useRegistration, RegistrationError } from '@jeswr/suite-sdk';

// Inside the existing PodAuthProvider.
const registration = useRegistration({ accountApi: 'https://provider.example/.account/' });
const available = await registration.available();
const preview = registration.previewUrls('alice'); // { pod, webId }
const checked = await registration.checkUsername('alice', { signal });
const identity = await registration.register(
  { username: 'alice', displayName: 'Alice', password },
  { signal, onStep: (step, created) => renderProgress(step, created) },
);
```

The hook delegates [pod-auth's CSS v7 registration API](../pod-auth/README.md#self-registration-registration-sdk-app-05).
No options defaults to accountApi:null; `available()` is asynchronous. Optional `podHost`, pristine
`fetch`, and `allowInsecureLoopback` have the same meaning as the core client. `methods` contains
only password. CSS's username-only login identifier is `<username>@registration.invalid`, not a
recovery email; show `created.loginId` when manual password sign-in is needed. The existing
provider owns OIDC UI and the resulting session. RegistrationError and the public registration
types are re-exported; errors retain their step and confirmed public progress, never credentials.

Handles stay stable within a session/options set. Committed identity and lifecycle changes,
including logout/login as the same account, replace them. Retained actions and stale probe results
reject with `Registration session changed`. Option replacement/unmount aborts active registration;
logout/expiry/restore/unrelated login also cancels it. The run's own matching login is permitted to
finish its profile write and return Identity while old retained actions are revoked. In-flight
failures remain typed RegistrationError values. No application shell wiring is included.

## Preferences (`SDK-APP-11`)

```ts
import { createPreferences } from '@jeswr/suite-sdk/preferences';

// Keep one factory for the current authenticated session. storage and typeIndex are existing clients.
const usePreferences = createPreferences({ storage, typeIndex, webId });
const railSchema = {
  parse(value: unknown): { collapsed: boolean } {
    if (!value || typeof value !== 'object' || !('collapsed' in value) ||
        typeof value.collapsed !== 'boolean') throw new Error('Invalid rail preference');
    return { collapsed: value.collapsed };
  },
};

function Rail() {
  const { value, set, loading, pending, error } = usePreferences(
    'rail', railSchema, { collapsed: false },
  );
  // set({ collapsed: true }) or set(current => ({ collapsed: !current.collapsed }))
  // Await set() for durable queuing and the current delivery attempt; render pending/error as needed.
  return null;
}

// On logout or session/client replacement, including logging in again as the same account:
usePreferences.dispose();
```

The hook returns `{ value, set(next | updater): Promise<void>, loading, pending, error }`.
The schema only needs `parse(unknown): T` (zod-compatible); `defaultValue` is required.
Keys match `[a-z0-9][a-z0-9.-]{0,63}` and are encoded in URLs. Examples include `rail`,
`density`, `onboarding`, `recentsearches`, `drive`, `docs.starred`, `docs.shared`, `tasks`,
`notes.pinned`, `connectors`, and `permissions.view`. Use lowercase `recentsearches` for the
app's camelCase `recentSearches` key. Values and defaults must be JSON. `PreferencesError.code`
classifies `invalid-key`, `invalid-json`, `too-large`, `session-changed`, `unsafe-location`,
`missing-etag` and `unsupported-access`. Sets reject invalid schemas/non-JSON values and values
larger than 64 KiB UTF-8; read/schema failures use the default and warn once per key per store.

On Solid, JSON lives at `<preferences-directory>/suite/<key>.json`. The directory comes from
the profile's `pim:preferencesFile`, or a `pim:ConfigurationFile` Type Index registration.
Without either, the store creates `settings` and registers its returned URL. LWS uses the
same logical layout while honoring server-assigned URLs: typed creation links identify the
settings/suite containers and individual keys for later discovery. Slugs never establish
LWS resource identity. Type Index and profile pointers must remain inside the selected storage.
Supply `profile?: RdfReadResult` with an already parsed WebID profile when hosted elsewhere;
otherwise the store reads it through the supplied storage client. Native non-RDF/missing LWS
profiles have no RDF preference pointer.

The suite container is owner-only before JSON access. The local WAC provisioner consumes
pod-access policy helpers and the server's advertised ACL link. It creates an owner-only ACL
only when the container has none of its own; an existing ACL is the owner's choice and is never
rewritten. For ACP/LWS, supply
`ensureOwnerOnly?: (containerUrl: string, signal: AbortSignal) => Promise<void>` to provision or
verify owner-only resource **and descendant** access through your deployment's access layer.
It must honor cancellation and be idempotent. Without a supported provisioner the store fails
closed. The public SDK currently lacks an exported container-provisioning/profile-pointer helper,
so these small equivalents live in this facade; the security-critical packages are unchanged.

Updates use ETags; Solid creates use If-None-Match: *. On 412 the store re-reads and retries once,
keeping the local whole value. A second conflict surfaces in `error` and preserves the queue.
Concurrent setters update memory immediately and coalesce to the latest whole value per key,
with one write in flight. Durable pending values replace the future SDK-APP-08 outbox through
a small internal replay interface. They replay in sequence on `online`, on the next committed
mount, or through `await usePreferences.flush()`. Ordinary storage/cache errors populate hook
state; offline sets remain `pending` until delivery succeeds. Without IndexedDB, caching and
queuing are memory-only. Without BroadcastChannel, tab updates are unavailable.

Memory, IndexedDB keys/envelopes and `BroadcastChannel('suite-prefs')` messages are scoped by
WebID and storage root. Another account's values never hydrate or broadcast into the current
store. Create a fresh factory per authenticated session and dispose the old one; this revokes
retained setters and aborts/fences late operations. Pending durable values remain available only
to that same WebID/storage session on restart. Construction and speculative renders do no I/O.

## Notification summaries (`./digest`)

`@jeswr/suite-sdk/digest` is pure TypeScript with no React or I/O. Adapt transport records to
`DigestNotification` (stable id, kind/category, app, actor/target, title, epoch `time`, read,
optional urgent/blocking). `classifyUrgency` identifies access requests, security/sign-in
notices, direct mentions, blocking agent approvals and explicitly urgent sources.

`buildDigest(records, { since, now })` includes `(since, now]`, deduplicates ids, groups by
app + target/thread + category, orders urgent/unread/newest/id, and returns sections, agent
counts and a deterministic headline. At most 50 groups and 100 ids per group are emitted;
counts and `omitted` retain the full eligible population. An explicit async
`summarise(digest): Promise<string>` option makes the call async and replaces only the headline.
No model or remote service is called by default. Hook failures propagate.

For delivery, pass `digestedIds` (an empty array for the first delivery) to replace the
lower timestamp boundary with ID receipts. Late arrivals are then included even when their
creation time precedes `since`, back to `since - lateWindow` (default `DEFAULT_LATE_WINDOW`,
7 days; `Infinity` disables the floor); future and invalid times remain excluded. The returned
`digestedIds` holds at most `DIGEST_RECEIPT_LIMIT` (500) receipts, least recently listed
first: every record in the current listing is refreshed, so a still-listed item keeps its
receipt however many newer ones arrive. When one listing exceeds the cap, the least urgent,
read and oldest receipts are dropped first. Persist it per account. Only a record listed
again after its receipt was evicted, inside the late window, can be included again.
Each item carries `key`, equal to `digestGroupKey(record)`, so adapters can match live
records to a card group. `unread` counts all unread eligible records,
including omitted groups, so delivery adapters can suppress pop-ups for read history.

`nextDigestTime(schedule, now, tz?)` returns the next Date strictly after now, or null for off.
Schedules use `mode: 'off' | 'hourly' | 'daily' | 'twice-daily'`; daily supplies `time: 'HH:MM'`,
twice daily supplies `times: [first, second]`. Optional `quietHours: { enabled, start, end }`
defers slots until quiet hours end; equal start/end disables quiet hours. `tz` is an IANA
zone (default UTC). Daily folds use the first occurrence; spring gaps shift by the gap's
duration. Hourly schedules include both occurrences of a repeated hour. `isDue(lastDelivered: Date | null, schedule, now, tz?)` catches up missed slots;
a null or future watermark is due immediately outside quiet hours. Callers own clocks, persistence,
account isolation, browser wake-up and desktop delivery.

`inQuietHours(quiet, now, tz = "UTC")` exposes the same quiet-hours predicate for delivery
adapters; reuse it rather than duplicating midnight-wrap rules in applications.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
## Smart chips

`@jeswr/suite-sdk/chips` provides `ChipRef`, `chipCandidates` over the existing search facade,
`resolveChip` (session-scoped, 30-second display metadata cache), text-composer helpers and
once-on-save mention notification drafts/delivery. `@jeswr/suite-sdk/chips/tiptap` exports
`createChipExtension`, an inline atom whose fallback HTML is a normal resource anchor. Person
chips that arrive by paste, or by a drop from outside the editor, become plain links
(`downgradePastedPeople`): foreign HTML can forge chip anchors, and a paste must not send mentions.
The suite-ui package supplies `Chip` hover cards and the keyboard-accessible `ChipPicker`.
See [SKILL.md](./SKILL.md) for lifecycle and receipt guarantees.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
Smart chip consumers can import types, validation, text helpers and `chipHref(ref, encodeRef)`
from the dependency-free `@jeswr/suite-sdk/chips/core` leaf. Tiptap's optional peers are used
only by `./chips/tiptap`. `createChipPeople` accepts a contact-loader adapter; `createChipSearch`
adapts shell search results without another index.

After acknowledged local saves, call `notifySavedHtml/Text(session, resource, before, after, title)`.
Only newly added person IRIs are notified. Supply loaded/last-saved content and the resource title
(maximum 120 characters in the notification); never pass private body text as the title. Do not
notify on import or remote merge. Collaborative editors can track local deltas with `addedChipRefs`
and send acknowledged additions through `notifySavedChips`. `htmlChipRefs` validates raw absolute
HTTP(S) hrefs. `createMentionNotifier` validates before receipts and isolates per-person failures.

`podScopedFetch(fetch, roots)` and `isOwnPodIri(iri, roots)` from `./pod-scoped-fetch` keep
authenticated reads inside one or more container roots (a string or an array). Each root gets
guarded-fetch's strict path-prefix check (same origin, segment boundary, no userinfo, no encoded
delimiters); in-scope requests refuse redirects. Chips pass only the user's storage; an app may
add the containers an opened resource owns (Docs adds a shared document's own folder). Foreign
reads bypass the session transport/cache, omit credentials, referrers and native caching, and
follow redirects (WebIDs often 303). Resolve foreign chips only on hover/focus.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Shared items (`./shared`, sst-iool)

`sharedItemsFromInbox(notifications, { storageUrl?, now? })` projects only share Announce
notifications into `SharedItem` records. Pass the user's `storageUrl`: resources inside it
(pod-scope containment, not origin) are never "shared with me". Announced resources outside it
must be public HTTPS (`isPublicHttpsUrl`: no `http:`, credentials, loopback, private or
link-local addresses, `.local`/single-label/cloud-internal names; judged by name and IP literal,
no DNS); anything else is dropped. Every projected item carries `announced: true`, which
`mergeSharedItems` keeps even when a local "opened" record merges in, so callers keep such items
preview-only (`previewOnly: item.announced`) however the record was later merged. A `published` claim later than
`now + SHARED_CLOCK_SKEW_MS` (5 minutes) is dropped, so a future date can neither pin an item to
the top nor outrank a hide. Sender, title and role are unverified assertions. `fromAnotherPod`
flags an actor that cannot be placed in the resource's pod: different origins always, and on
the user's own host pod roots at the user's storage depth (path-based multi-pod hosts). Callers
display the resource origin first and label announcement senders and roles as unverified. No
grants or resource reads occur here.

`isShareNotification(n)` is the share Announce test `sharedItemsFromInbox` applies (summary
`Shared with you as …` and an http(s) object without credentials), regardless of storage.
`shareNotificationUrls(candidates, { fetch, webId, storageUrl, publicFetch?, inbox?, pinningFetch?, signal?, maxItems? })`
returns the candidate inbox members that are share Announces, read through the pod-access inbox
reader. It requests only the profile (skipped when `inbox` is given), the inbox container and
the candidates; every other URL is answered locally with 404, which the reader skips. Home's
Requests page uses it so share notifications, which `listRequests` reports as unreadable, are
not counted as unreadable requests. An abort through the `signal` rejects (a transport's own timeout is a network failure), even one during discovery. Credentials stay
inside `storageUrl` (`podScopedFetch`: session fetch, redirects refused); a profile outside it is
read through `publicFetch` (or a credential-free global fetch), and an inbox outside it is never
read.

`readSharedInbox({ webId, storageUrl, fetch, publicFetch?, pinningFetch?, signal?, maxItems? })`
is the Shared with me read, confined the same way. It returns `{ status: "ok", notifications,
truncated, limit }`, `{ status: "none" }` (a profile naming no inbox, or a missing inbox) or
`{ status: "failed", reason }` with `reason` one of `network`, `forbidden`, `lws-no-ldn` (an LWS
profile has no LDN inbox) or `outside-storage`, so callers can show an error with Retry instead of
an empty state. The bound is `SHARED_INBOX_LIMIT` (100, Requests' bound); one extra member is read
to set `truncated`, and the newest `limit` notifications read are returned (the container listing
order decides which members are read at all). Aborts reject.

`resolveSuiteResource(hints, { encodeRef, encodeContactRef?, shared?, storageUrl?, previewOnly?, hints? })`
is the single resource-to-app/route resolver for search and Shared. RDF types match canonical
`@jeswr/suite-vocab` IRIs (including known legacy aliases), never arbitrary local names.
MIME, filename and path hints supply display classifications; search passes `hints: false` so
only RDF types choose an app and generic rows stay in Drive (and in Drive-scoped search). A hint
never turns a container into a file: untyped containers are Drive folders, except Sheets'
native `sheets/<name>/` workbook layout. Shared routes require native formats and routers that
can open shared resources: Tasks trackers (`wf:Tracker`, or untyped `.ttl` directly in
`tasks/projects/`), and native Docs documents / Sheets containers inside the user's storage
(pod-scope containment, never origin). Other resources fall back to Drive: containers open the
folder view, files the preview. Callers set `previewOnly` for unverified inbox resources outside
the user's storage or with an actor from another pod. Document references omit fragments; Tasks search keeps
the task subject. `classifySharedItem` delegates to this resolver. `sharedApps` exports the
runtime list underlying `SharedApp`.

`isDirectChild` is the common fail-closed document layout check; `isSuiteDocsDocument` applies
it to Drive's native Docs scope. `mergeSharedItems(...sources)` deduplicates exact URLs newest
first (undated last), fills missing fields, and prefers names from local app/open sources over
inbox titles regardless of date. Inputs are never mutated. `latestSharedEntries` preserves
Drive's stable insertion order for equal dates and its existing NaN comparison behavior.

Storage belongs to callers: `sharedAccountKey` keeps Tasks' encoded WebID key convention,
`parseSharedEntries` validates stored lists, and `sharedItemsForAccount` prevents fallback
memory from crossing accounts. `hideSharedItem` stores `{ url, hiddenAt }`; `visibleSharedItems`
suppresses only records with no `sharedAt`/`openedAt` later than `hiddenAt`. Hide with
`sharedHiddenAt(record)` (the later of now and the record's own dates) so a skewed sender date
cannot outrank the hide. Persist hidden
entries per WebID, validate with `isHiddenSharedItem`, and clear them when the user reopens a
resource. Tasks removal must forget its cache entry and remove its preference entry. Reject
stale callbacks on session replacement. `removeSharedItem` and `isSharedUrlEntry` remain generic
URL-list helpers. Only `shareNotificationUrls` performs I/O.

## Undo (`./undo`, UX-6)

`createUndoStack({ limit = 50, now = Date.now, isRetryable = () => false })` creates
framework-independent, in-memory history. Import `UndoEntry`, `UndoStack`, `UndoItem`,
`UndoResult` and `UndoStackOptions` from `@jeswr/suite-sdk/undo`.

- `push({ label, scope, undo, redo?, expiresAt? })` returns a unique ID and clears only
  that scope's redo history. `undo(scope)` selects the latest live entry;
  `undoById(id)` selects the exact entry offered by a toast; `redo(scope)` reapplies it.
- All callbacks receive an `AbortSignal`. One callback runs at a time across the stack;
  concurrent requests resolve `{ status: 'busy' }`. Results are `{ status: 'done', id,
  label }` (the entry that ran), `nothing`, `busy`, `expired`, or `{ status: 'failed', error }`. Expiry uses milliseconds since
  epoch; entries with `expiresAt <= now()` are dropped without running.
- Failed operations are consumed unless `isRetryable(error)` returns true. Retryable
  entries stay in their original position. A new push during undo prevents its redo
  from becoming available; a redo that was running when a push retired it is kept as an
  undo entry below the push. Undo-only entries are consumed on success.
- `canUndo(scope)` and `canRedo(scope)` say whether a live entry exists, so a shortcut can
  leave the key alone when there is nothing to do. Subscribers are notified when an
  entry with `expiresAt` expires.
- At most `limit` entries, counting undo and redo history, are retained per scope;
  oldest entries are dropped. `limit` must be a positive integer.
- `entries(scope?)` returns pending undo entries oldest first, with `{ id, label,
  scope, canRedo }`; `canRedo` indicates that the entry supplies a redo callback.
  `subscribe(listener)` returns an unsubscribe function. The unfiltered snapshot is
  stable between changes; `useUndoStack(stack)` from `@jeswr/suite-sdk` subscribes with
  `useSyncExternalStore` and supplies an empty snapshot during server rendering.
- `clear()` removes all history and aborts the running callback. Late settlements
  cannot restore cleared entries. The callback must pass the signal into its I/O
  and check it before changing local state. An ignored abort cannot cancel a write
  already performed by a transport.

### Adopting the undo stack

In the suite shell, call `useUndo()` from `shell/undo/provider` and push the inverse
**after a successful reversible change**. The shell supplies the current route's app
scope, an Undo toast, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z. Native undo in editable controls
is preserved. The shell retires history and toast actions on account replacement or
sign-out. Standalone clients own a stack per session and call `clear()` on teardown.

For an ordinary Tasks completion, capture the open/closed state and completion
timestamp before writing, then register both transitions through the app's adapter:

```ts
import { createUndoStack } from '@jeswr/suite-sdk/undo';

const stack = createUndoStack(); // owned by the authenticated session
async function completeTask(task: Task) {
  const previous = { state: task.state, endedAt: task.endedAt };
  const next = { state: 'closed' as const, endedAt: new Date() };
  await writeCompletion(task.url, next);
  stack.push({
    label: `Completed ${task.title}`,
    scope: 'tasks',
    undo: (signal) => writeCompletion(task.url, previous, { signal }),
    redo: (signal) => writeCompletion(task.url, next, { signal }),
  });
}
```

`writeCompletion` is the app's existing persistence adapter; it updates its local
completion state and writes the same fields. In a shell component, use `push` from
`useUndo()` in place of `stack.push` and omit `scope`. Capture values rather than
closing over a mutable task, preserve unrelated fields, and supply redo only when
repeating the operation is supported. Tasks' repeating completion also retains its
`CompletionPlan.previous` snapshot and reserved `copyUrl`: undo restores due date,
all-day and reminder fields and removes that completed occurrence. Preserve that
existing `undoCompletion(stored, result)` behavior in the migration adapter; only
provide redo if it can reuse the same occurrence identity. Delayed deletion entries
should set `expiresAt`
to the point when restoring the resource stops being possible. Tasks and Drive's
existing flows are migrated separately.
