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
`RemoteContextRefusedError` and never fetches a context. Inline context objects remain supported.
Deterministic document paths and Type Index bootstrap
behavior are preserved. The runner
retains read preconditions for subsequent writes; explicit write conditions override them.

Entry points:

- `.`: contracts, runners, catalog, config factory, fetch-backed writer, errors.
- `./oauth`: browser PKCE helpers and popup flow (only `authorize` touches `window`).
- `./node`: host-neutral runtime primitives; CLI implementation belongs to CON-03.
- `./testing`: recorded fixture fetch, memory Pod and import helpers; fail-closed fixture recorder.
- `./adapters/<id>`: each source's existing adapter (OAuth or export-file).
- `./core/*`, `./pod/*`, `./<id>/*`, `./registry`, `./types`, `./file-adapters`:
  compatibility modules used by Pod Manager's thin re-export shims.

`pnpm --filter @jeswr/pod-connectors build` builds ESM and declarations. `test` runs all
moved fixture tests and the environment-read regression test without production traffic.

## Incremental imports and provenance

Pass host-owned `state: ConnectorState` into `runImport` (or `runFileImport`) and persist
`report.state` after success. `onState` also receives failed outcomes, preserving the previous
successful cursor, sync time and counts. State contains ISO date strings and never tokens or
exception text. An explicit `cursor` overrides the state's cursor for API imports.

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

Every collection and item carries `prov:wasDerivedFrom` and `prov:wasGeneratedBy`. Item
`schema:url` supplies its source; `NormalisedDoc.sourceUrl` can supply a document-specific
fallback. Otherwise the source API origin or a connector export URN is used. Each run has one
activity in the connector's reserved `_provenance.ttl`, with source IRIs, connector IRI and
start/end times. This companion document is excluded from imported-document counts and Type
Index registration. Failed runs attempt provenance recording and retain the original error.

Each adapter exposes a `vocab-map.ts` seam, applied by the runner without mutating adapter
input. Existing music, calendar and social class alignments add sector types alongside legacy
types. Detailed adapter field mappings remain with their later connector tasks. The ontology
package currently has no runtime API, so its exact term IRIs are isolated in
`core/federation-vocab.ts` for the subsequent constants switch (see root `QUESTIONS.md`).

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
route prefix, method, status and redacted JSON only. Recording and replay select the longest
matching prefix on the same origin and complete path segments, independently of route or request
order. Responses sharing a method and static prefix replay in request order, even if recording
responses complete out of order. Repeated
keys form a finite sequence; replay fails when that sequence is exhausted. Single-entry keys
remain reusable for existing static demo fixtures. All headers, request bodies, dynamic URLs
and unlisted JSON fields are omitted. Known token, cookie and personal keys cannot be
allowlisted; empty allowlists are the default. Hosts must ensure every allowed scalar is
non-personal and use synthetic replacements when replay requires personal fields. Tests use
mocked source transports and memory Pods only.

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
