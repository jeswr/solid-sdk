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
- `./node`: Node CLI, client-credentials Pod fetch, loopback source PKCE and state store.
- `./testing`: recorded fixture fetch, memory Pod and import helpers; fail-closed fixture recorder.
- `./adapters/<id>`: each source's existing adapter (OAuth or export-file).
- `./core/*`, `./pod/*`, `./<id>/*`, `./registry`, `./types`, `./file-adapters`:
  compatibility modules used by Pod Manager's thin re-export shims.

`pnpm --filter @jeswr/pod-connectors build` builds ESM and declarations. `test` runs all
moved fixture tests and the environment-read regression test without production traffic.

## Binary resources

Adapters store non-RDF resources (original files, `.eml` sources, attachments) with
`ctx.writeBinary({ slug, contentType, body, mode })`. The fetch-backed writer confines them to
the connector container exactly like RDF writes and refuses RDF media types (those go through
`ctx.write` so N3 serialises them and provenance is attached). `mode: 'create'` (default) sends
`If-None-Match: *` and reports an existing resource as `created: false`; `mode: 'replace'`
reads the current ETag and sends `If-Match`, refusing resources without a strong ETag. Hosts
whose `PodWriter` has no `writeBinary` make the call fail with `IntegrationSyncError`.

## Mail (Gmail and the shared MailWriter)

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
Message-ID remains message metadata and supplies In-Reply-To links. History deletions resolve
the message path directly; full syncs sweep vanished Gmail messages by listing `messages/`.
No separate source index is stored.

`./mail` exports `createMailWriter(ctx, account)`, shared with the Takeout mbox path: `add()` stores
one raw message, then `flush()` writes accumulated thread and folder membership once per run.
File imports retain Message-ID document keys with collision fallback and References/In-Reply-To
thread ancestry. An explicit `documentId` bypasses Message-ID keying. Additions commit RDF before
bytes and collections; `removeMessage()` immediately removes collection memberships, then
attachments and `.eml`, and deletes RDF last. An interrupted deletion retains its cleanup inventory
in that RDF for replay; a missing document is a no-op. Attachment media types from mail are
untrusted: RDF and malformed types are stored as `application/octet-stream`.
## Node CLI

Build the package and run `pod-connectors import spotify`, or
`node packages/pod-connectors/dist/node/bin.js import spotify` from the workspace.
`import netflix --file ./NetflixViewingHistory.csv` uses the file runner. Add the bare
`--since` flag to an API import to resume its stored cursor; omission starts a full import.
File imports reject `--since`. `--help` prints usage.

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

Pod login uses CSS client credentials and DPoP, including bounded nonce retries and an
in-memory token cache. Source login displays a browser URL, binds only `127.0.0.1` on an
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

The CLI stores `<podRoot>integrations/<id>/state.json`, including failed outcomes while
retaining the last successful checkpoint. Before accessing JSON, it discovers the resource's
`rel="acl"` link and writes a WAC ACL granting only the owner WebID Read, Write and Control.
The ACL must be in the same connector container. Missing ACL discovery or rejected ACL
writes fail closed; ACP/LWS state protection belongs to later storage integration.
Conditional JSON PUTs reject stale ETags and concurrent creates. State persistence failures
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
Financial activities remain separately typed without that link. For required
`core:about` cardinality, `core:subject` supplies the data subject through its
declared subproperty relation.
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
`poddrive:md5Checksum` and `poddrive:contentSkipped` use `https://jeswr.org/ns/pod-drive#`.
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
reason is present. Downloads may overlap; each file's Pod
mutations and cleanup are serialized within the runtime. Every successful store lists that
file's container and removes unlinked canonical representations, including abandoned exports
and legacy `content`, `content.pdf`, and `content.txt` paths. This also runs for metadata-only
transitions even when previous metadata has no encoding links.
Malformed and RDF content types are stored as `application/octet-stream`.

Downloads accumulate at most the configured byte cap and cancel/abort oversized responses.
`PodWriter.writeBinary` currently takes `Uint8Array`; true streaming request bodies require a
future writer port. JSON-only demo fixtures show metadata; sync tests wrap `fixtureFetch`
with synthetic byte responses for media/export routes, without changing its public behavior.
