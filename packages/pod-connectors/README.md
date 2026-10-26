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

Imported documents and resources inside the writer's resolved connector container carry
`prov:wasDerivedFrom` and `prov:wasGeneratedBy`. Externally linked identities retain their
required typing without import-generation provenance and are excluded from item counts. Item
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

## Streaming file imports

Apple Health, Netflix, Amazon orders, Uber, WhatsApp, Goodreads, Steam, ChatGPT
and bank statements prefer the native `File.stream()` byte reader. Text-only
`ImportFile` implementations remain compatible. CSV rows (including quoted
newlines), XML start tags, OFX transactions, multiline chat messages and selected
JSON array members are parsed incrementally. UTF-8 decoding spans chunks; readers
are released or cancelled when parsing ends or fails. The 64 MiB limit is also
checked against actual bytes read. Existing deterministic documents and the
100,000-record cap are preserved: RDF snapshots remain in memory up to that cap.
CSV headers are parsed and normalised once per file, including bank column
aliases, and are limited to 1,024 columns and 65,536 characters.
OFX transactions use an incremental delimiter scanner and are limited to 64 KiB
of UTF-8 text. Oversized or unfinished transactions are skipped and counted in
`report.skipped` and `report.state.counts.skipped`.
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
`dcterms:title`, notes have `social:content`, transaction records link through
`core:about` to distinct local activities, and health records name an unnamed
local `core:Person` through `core:subject`. Financial records use the importing
user's WebID as `core:subject`, typed `core:Agent`. The fetch-backed writer exposes
its configured WebID; custom `PodWriter` implementations must supply `webId` for
financial file imports and Steam account metadata. Steam accounts link to that WebID
as a `core:Agent` and `core:AccountHolder`, and to Steam's public site as a
`core:AccountProvider`. Imports fail before writing the affected document when
that identity is missing or invalid. Financial activities retain the broad
`core:Activity` type because exports may omit the currency or posting time needed
by the `fin:Transaction` shape; missing source facts are not inferred.
Goodreads books, Steam items/accounts and conversations with a ChatGPT id carry
their source item URL for provenance; other records use the connector export URN.
No MCP-16 parser is present in this checkout, so ChatGPT reuses its existing
conversation parser for each streamed conversation.

Synthetic fixture tests cover every importer with one-byte, seven-byte and
single-chunk input, sorted Turtle mapping snapshots, provenance and stable
re-import. They assert the required predicates, cardinalities, datatypes and
linked classes from the checked-in sector shapes, following the class hierarchy
in the core and sector ontologies. Every Tier C fixture snapshot also validates inherited
core constraints. These checks add no SHACL dependency.
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
