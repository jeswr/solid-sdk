<!-- // AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/suite-sdk

> **Experimental — AI-agent-generated.** Private registration, notification, search, preferences and offline facades.

Mount `PodAuthProvider` from `@jeswr/pod-auth/react`, then use the provider's authenticated
fetch and current actor through the hook:

```ts
import { assignmentAnnounce, useNotify } from '@jeswr/suite-sdk';

const notify = useNotify();
const result = await notify(assignee, assignmentAnnounce(task, tracker, name, title));
```

`notify` is a stable callable until the identity, fetch, or explicit options change. The hook
resets its discovery cache on session changes. Delivery failures return `delivered: false`.
Without a sender WebID or explicit activity actor it returns a `network` failure without sending.
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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
### Smart chips

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
