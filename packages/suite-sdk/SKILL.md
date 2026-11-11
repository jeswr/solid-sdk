---
name: suite-sdk
description: Use when working on @jeswr/suite-sdk registration, notifications, server/local search, LocalIndex feeders, useSearch, useNotify, or useInbox integration with PodAuthProvider.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/suite-sdk

The root exposes SDK-APP-05's `useRegistration()` and SDK-APP-07's `useNotify()`, `useInbox()` and notification builders. SDK-APP-09's
search facade lives at `@jeswr/suite-sdk/search`; application shell wiring is separate.
Do not infer that the other planned SDK facade APIs are implemented.

Read `packages/pod-access/SKILL.md` for notification API details. Use `PodAuthProvider` from
`@jeswr/pod-auth/react`; never create another auth session or modify credentials in this facade.
The notifier cache belongs to the current identity and must reset on lifecycle/account changes.
Recipient protocol hints describe the recipient, independently of the current identity's protocol.
Preserve the explicit DNS-pinning requirement for Node transports and all redirect refusals.

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
