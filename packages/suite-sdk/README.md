<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/suite-sdk

> **Experimental — AI-agent-generated.** Private notification and search facades.

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
and the listing's RDF types. `containerSearchDataset(containerUrl, entries)` also exposes
the RDF/JS quads directly. A complete replacement removes old listing members while retaining
cached resource graphs; remove those separately with `index.remove(resourceUrl)` on deletion.

solid-offline's warmer currently exposes `onVisit` metadata without a dataset. Invoke
`feeder.resource` from the page's parsed-cache pipeline and `feeder.container` from completed
listings; the facade does not change the warmer. The caller owns refresh/invalidation and
must dispose the engine and purge persisted index data on logout/account switches. Local
results cover fed cached data only. Application shell wiring is a separate PR.
