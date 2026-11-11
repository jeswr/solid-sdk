---
name: suite-sdk
description: Use when working on @jeswr/suite-sdk notifications, server/local search, LocalIndex feeders, useSearch, or useNotify integration with PodAuthProvider.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/suite-sdk

The root exposes SDK-APP-07's `useNotify()` and notification builders. SDK-APP-09's
search facade lives at `@jeswr/suite-sdk/search`; application shell wiring is separate.
Do not infer that the other planned SDK facade APIs are implemented.

Read `packages/pod-access/SKILL.md` for notification API details. Use `PodAuthProvider` from
`@jeswr/pod-auth/react`; never create another auth session or modify credentials in this facade.
The notifier cache belongs to the current identity and must reset on lifecycle/account changes.
Recipient protocol hints describe the recipient, independently of the current identity's protocol.
Preserve the explicit DNS-pinning requirement for Node transports and all redirect refusals.

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
successful StorageClient listing. Build synthetic quads using rdf-engine's shared n3
DataFactory, never string-built Turtle. Include decoded member names and listing metadata so
binary names and recents work without fetching binary bytes. Do not pass an incomplete page
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
