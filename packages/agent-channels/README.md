<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-channels

> Experimental — AI-agent-generated. Private workspace package; sends default to dry-run.

Channel contracts, carriage profiles, capability RDF and origin enforcement for DESIGN §3
(A-005 / sst-31t), plus email MIME and Gmail REST (A-006 / sst-dez), shared metadata carriage
(A-014 / sst-wxu), Microsoft Graph mail (A-024 / sst-1zu) and Discord (A-030 / sst-r57).
The `ChannelBinding` and `CarriageProfile` declarations follow §3.1.

The root exports the shared legacy `BridgeMessage`, email projection helpers,
`ChannelAdapter`, explicit-parser `InMemoryChannelAdapter`, `TokenProvider`, profile
constants, `toRdf` and `capabilityToTurtle`. RDF delegates to agent-model's validated
Solid Resource / RDFJS wrapper mapping and rdf-serialize. Legacy-bridge re-exports
these shapes, preserving its email-default adapter and parser.

`createOriginScopedFetch(ORIGINS, options)` snapshots the binding's origins before any
request. It checks each target before DNS/connection, uses guarded-fetch with DNS
pinning by default, and refuses redirects. `options.createTransport` is a trusted
factory for a DNS-pinning transport or test fake. It receives frozen construction
options including `maxRedirects: 0`, which it must apply internally: passing a
preconstructed redirect-following fetch is unsafe because an outer refusal runs
after that fetch has already followed the redirect. `allowLoopback` is exclusively
for local tests.

`./direct` exports only `createDirectReader`. `./direct/send` owns the send half;
only agent-executor and channel tests may import it. `./testing` exports
`createInMemoryDirectBinding` and `RecordingTokenProvider` for tests. Layer lint
permits that single internal test-factory composition edge and refuses production
imports of `./testing`.

`./provider/send` exports the shared `ProviderRejectedError` class without loading
reader or provider implementations. Executor adapters may use this send-only surface
to distinguish definitive pre-delivery refusals from uncertain errors. Preserve the
class identity when adapting sends; a name or message string is not sufficient evidence.

The test factory takes `{ tokens, verify, now? }`. `verify` must be a pure local
signature verifier returning the protected Message after checking the pinned key
and intended audience. Missing/unverifiable messages fail closed. Rendering is
deterministic; validation and transmission enforce freshness. Lookup may reconcile
an accepted message after expiry, using exact bytes as positive evidence.
Parsed BridgeMessages carry unverified JSON-LD; parsing confers no authority.
The root's pure `readEnvelope(raw)` validator is also used for daemon eligibility.
It applies the same 64 KiB byte and compact-JWS string bounds as the direct parser.

`transmit(wire, { account, tokens, assertAuthority, dryRun? })` defaults to dry-run. Explicit
`dryRun: false` delivers only to the isolated in-memory inbox selected by `account`;
there is no network transport. Read paths request only `tokens.read(account)`;
send paths request only `tokens.send(account)`. Grants carry distinct `access`
discriminants and nonempty tokens. The recording provider uses distinct fake grants.
The executor supplies a required synchronous `assertAuthority()` fence. Every send
binding calls it after all credential, signature, approval and preflight awaits,
immediately before issuing each guarded fetch (including Matrix room-state reads)
or accepting a direct message. No await separates the fence from that request.
It checks the executor revision and authority deadlines; a grant alone never
authorizes a later transmission. Invalidation fails definitively before delivery.
Pagination is account-scoped, bounded by total bytes and item count, and fails when
the next item cannot fit. Exact repeated sends are idempotent; conflicting bytes
or destination accounts are refused. Lookup has `finalAbsence: true`.

All DESIGN §3.2 rows have frozen constants in `CARRIAGE_PROFILES`. Only email's
25,000,000-byte limit is specified there. Other structured profiles use the pilot's
64 KiB local ceiling; Discord uses an 8 KiB local JSON request ceiling with separate
2000-character content and 2048-character footer limits; Signal/WhatsApp use the
64 KiB local ceiling over Matrix. Other footer-only profiles
conservatively cap at 256 bytes pending their binding tasks. LinkedIn/X have zero-byte read-only profiles. No profile
constant implements sending. The direct descriptor advertises zero owner rate
limits by default; it is a capability statement, never permission to send.

Gmail, Microsoft Graph mail, GitHub notifications, Mastodon, Discord, Matrix and the
optional read-only X binding are implemented; see their sections below.

Gmail notification triage labels recognised LinkedIn notification senders as
`linkedin-proxy`, retaining the email provenance and an explicit unverified warning.
`./x` exports the opt-in `createXReader` and a shared `createXSpendCounter`; the
counter refuses calls beyond a configured cap within each UTC accounting period.
There is no LinkedIn or X send binding. See [LinkedIn and X limits](../../docs/bindings/linkedin-x.md)
for the mailbox rule, OAuth 2 PKCE read scopes, configured cost bounds and
process-local counter lifetime.

`./github` exports `createGithubReader({ account, now? })` (A-033 / sst-cq2).
It ingests notification metadata with `gh api /notifications` and
`/notifications/threads/{id}`. Install `gh` and authenticate it separately with
`gh auth`; the binding never obtains tokens or calls `TokenProvider`. The daemon
must associate the opaque `account.id` with that process's active GitHub account,
keep the auth context fixed during pulls, and use a separate context for each
account. Requests explicitly select `github.com` and GET, use `execFile` with an
argument array and `shell: false`, and cap output at 1 MiB with a 30-second deadline.
Provider URLs are never followed. Child-process errors discard stdout/stderr.

```ts
import { createGithubReader } from '@jeswr/agent-channels/github';

const account = { id: 'github-personal' };
const reader = createGithubReader({ account });
const page = await reader.ingest.list(account, savedCursor, {
  maxItems: 20,
  maxBytes: 256 * 1024,
});
for (const item of page.items) {
  const message = reader.ingest.parse(item);
  // Persist the message before advancing the saved cursor to page.next.
}
```

One list call reads at most one 50-item provider page and fetches thread details
until either caller bound is reached. Cursors bind to the configured account,
retain pending thread IDs from the fetched page and the polling window. Completed
windows overlap one second; consumers must deduplicate stable message IDs. A
nonempty result may have another page, and an empty result may complete a window.
Continue from `page.next` on subsequent scheduled pulls. Pending IDs are drained
without re-fetching the list.
Concurrent updates can shift records between provider pages, so multi-page windows
are replayed until two complete ID scans agree before advancing the completed
watermark. Scans use bounded fingerprints rather than retaining the entire window;
continued provider changes can require additional pulls and replays. Legacy offset
cursors conservatively replay their window from page one. No read/done mutations
are made (`all=true` includes already-read notifications).

Parsing uses the exact thread response bytes for provenance, enforces the shared
64 KiB/depth/node/string caps, strips controls from metadata, and ignores `native`.
The subject title becomes plain text; repository, reason and subject type become
low-trust signals. Thread metadata identifies no sender and provides no issue or
comment body. Updates have distinct message IDs (`github:<id>:<updated_at>`) and
share a conversation key (`github:<id>`). Malformed items raise `ChannelParseError`.
The frozen `GITHUB_READ_ONLY` profile and descriptor advertise zero send bytes,
`sendSupported: false`, and no structured payload. There is no `./github/send`.
See the [GitHub notification API](https://docs.github.com/en/rest/activity/notifications)
and [`gh api` manual](https://cli.github.com/manual/gh_api) for provider behavior.

Provider exports without a section above remain reserved for their own tasks. Packages
remain private per ADR-001 D5.

Run `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, and `pnpm run test` here.

Tests enforce 100% coverage per source file in every metric, with real local
Ed25519 signatures, adversarial inputs, a loopback HTTP server and a Turtle golden.

`./email-mime` implements the pilot's bounded MIME inspection and provider-copy
verification. The caller injects legacy-bridge's `parseEmail` function; this keeps
its hardened parser and avoids reversing legacy-bridge's dependency on channels.
`inspectEmail(raw, { parseEmail, recipient, ownAccounts, footer? })` returns the
BridgeMessage, unverified structured proposal and parity result. The trusted
receiving account selects STRICT parity when it is in `ownAccounts`, otherwise
LENIENT parity. An unauthenticated `To` header cannot select a weaker mode.
Plain human email remains an observation. Conflicting carriers always fail closed;
parsing and parity never confer verified identity or authority.
Before returning a proposal, inspection checks every JSON-LD part and HTML script
carrier in the bounded MIME tree, including copies omitted by the legacy parser's
caps. Incomplete extraction or unparseable JSON-LD refuses the proposal in both modes.

`./email-mime/send` exports `createEmailRenderer({ from, recipients, footer?,
verify, now? })`. `recipients` pins actor identifiers to single mailboxes; no
inbound Reply-To or model-selected address is used. The pure local `verify`
callback verifies the compact JWS, sender key and intended audience. Rendering
preserves the pilot's deterministic synthetic-test summary and appends the
configured single-line footer (default `AGENT_FOOTER`, DESIGN §3.2's J2 wording).
Send, inspect, Gmail ingest and provider-copy lookup all use that same default;
a deployment overriding it must supply the same footer for STRICT parity. MIME has plain text,
HTML with an inline JSON-LD carrier, a matching `application/ld+json` attachment,
and `X-Agentic-Reply: 1`. Its date and boundaries are derived from protected
content, so rendering and validation re-derive identical bytes. Validation checks
the entire MIME and digest, refusing extra recipients, changed headers or content.
The pilot's 512 KiB local MIME ceiling remains stricter than email's advertised
25,000,000-byte provider profile. MIME itself has no transmit method.


`./gmail` exports `ORIGINS` and `createGmailReader({ tokens, parseEmail, recipient,
ownAccounts, footer?, transport? })`. Reads use only `TokenProvider.read`. The
binding fixes the API user to `me`, snapshots the allowed origins
(`https://gmail.googleapis.com`, `https://www.googleapis.com`), and refuses
redirects through `createOriginScopedFetch`. `transport` uses the same trusted
transport-construction seam as that guard; tests inject recorded fixture responses.

`ingest.list` captures `users.getProfile.historyId` before an initial full
`users.messages.list`, then retrieves `users.messages.get?format=raw`. Later polls
use `users.history.list` with `startHistoryId` and `historyTypes=messageAdded`.
Only a history 404 triggers a new full listing. The opaque account-scoped cursor
retains page tokens, pending IDs and the baseline until every page is drained;
item and aggregate raw-byte bounds never drop pending messages. Duplicate IDs
within a page are fetched once, deleted-message 404s are skipped, and other
failures leave the caller's previous cursor usable. A page holds at most 512
pending IDs; the next item must fit the byte bound to make progress.

`./gmail/send` exports `createGmailSend`, combining the MIME render options with
`{ account, tokens, parseEmail, verifyApproval, transport? }`. The executor must
supply `verifyApproval(wire, account)`, which verifies a current owner approval
bound to that exact digest and sender account. Capability descriptions and
recipient pins grant no authority. A real transmit requires `dryRun: false`,
verified signed content, an exact re-render, current validity, the configured
account, a separate `TokenProvider.send` grant, and successful owner approval.
Validity is rechecked after credentials and approval await, then the executor
authority fence runs synchronously before the request. Dry-run requests no
credentials and makes no network call.

Transmit uses `users.messages.send` with the reviewed MIME as canonical base64url.
HTTP 400 is a definitive `ProviderRejectedError`; explicit OAuth refusals described
below also fail definitively. Other failures or a malformed acknowledgement remain
uncertain. This binding performs no send retries. Lookup
preserves the pilot Message-ID derivation and uses read credentials to search
`rfc822msgid:` across all labels and inspects at
most ten raw candidates with `verifyProviderCopy`. Added provider headers are
allowed; changed original headers, recipients, signed content or human copies
are refused. Lookup works after message expiry and returns only `found` or
`unknown`. Gmail never sets `finalAbsence`.

The root exports pure DESIGN §3.2 envelope codecs. `encodeEnvelope(compactJws)`
produces canonical JSON-LD with the inline context `{ agent: AGENT }`, type
`agent:SignedMessage`, `agent:wireFormat: "jws-compact"`, and `agent:compactJws`.
`decodeEnvelope(textOrBytes)` returns `{ text, compactJws }` after bounded UTF-8/JSON
parsing and exact context/field checks. `encodeEnvelopeObject` and
`decodeEnvelopeObject` provide the same contract for parsed objects, including
Teams Adaptive Card `data`. Decoders reject remote contexts, extra fields and
object accessors. They never fetch, verify signatures or grant authority.

`encodeMetadataField` / `decodeMetadataField` wrap that envelope as Slack
`{ event_type: ENVELOPE_KEY, event_payload: envelope }`. `encodeEventContent` /
`decodeEventContent` use Matrix's `content[ENVELOPE_KEY]`, preserving unrelated
`body`/`msgtype` fields on decode. `ENVELOPE_KEY` is `org.jeswr.agent.envelope`.
These utilities cap the envelope at 64 KiB; provider bindings must also bound the
complete message and add the required human footer. They implement no sends.

The email contract keeps all three copies on every outbound MIME: deterministic
plain text with the configured footer, HTML with that same text and an inline
JSON-LD script, and an identical JSON-LD MIME attachment. `X-Agentic-Reply: 1`
advertises carriage support; `List-Unsubscribe` is absent. The signed propose
golden fixture in `test/fixtures/propose.eml` passes STRICT parity on its own output.
Legacy-bridge's `detectBridgeCapability` consumes the parsed headers, JSON-LD
blocks and text body to report unverified discovery hints; see its PROTOCOL.md.

`./graph-mail` exports `ORIGINS` and `createGraphMailReader` with the same
`{ tokens, parseEmail, recipient, ownAccounts, footer?, transport? }` options as Gmail.
It resolves `/v1.0/me/mailFolders/inbox?$select=id` once per account and reader,
then reads `/v1.0/me/mailFolders/inbox/messages/delta?$select=id`, follows validated
`@odata.nextLink` / `@odata.deltaLink` URLs, and retrieves each message's MIME via
`/v1.0/me/messages/{id}/$value`. The same injected email parser enforces parity.
Requests use immutable Graph IDs. Cursors bind the account and preserve pending
IDs until the item/byte limits are drained. Duplicate IDs within a page and deleted
tombstones are skipped; a MIME 404 skips a deleted item. HTTP 410 or a 4xx response
with error code `syncStateNotFound` on a saved delta state restarts the initial
inbox sync. Other errors preserve the previous cursor for retry. Pages cap at 512
rows and cursors at 64 KiB.

Continuation URLs accept slash and parenthesized folder keys, including lowercase
`mailfolders`, for the inbox alias or the independently resolved inbox ID. They must stay on the inbox delta operation at
`https://graph.microsoft.com`; credentials in URLs, fragments, duplicate query
parameters, other operations and repeated next-page links are refused. The
declared origins are `https://graph.microsoft.com` and
`https://login.microsoftonline.com`. Origin sets cannot widen token destinations;
redirects remain refused. OAuth is owned by agent-credentials. Composition adapts
`StoreTokenProvider('microsoft', { store, transport, resource: 'mail' })`'s token
strings to the channel's `{ access, accessToken }` grants, using its separate
`read(account.id)` / `send(account.id)` methods (`Mail.Read` / `Mail.Send`). The
channel never opens a credential store or acquires consent itself.

`./graph-mail/send` exports `createGraphMailSend`, with the same options and owner
approval contract as `createGmailSend`. It renders and validates the canonical
§3.2 MIME, then projects those exact checked bodies, pinned mailboxes, subject and
deterministic `internetMessageId` into Graph message JSON. `/me/sendMail` receives
the HTML body with its inline JSON-LD, a matching `#microsoft.graph.fileAttachment`
containing base64 JSON-LD, `internetMessageHeaders` containing `X-Agentic-Reply: 1`,
and `saveToSentItems: true`. Graph's JSON API accepts one HTML body; Exchange
generates the plain-text alternative. No weaker receiver parity mode is selected
to accommodate provider rewriting.

Real sends require `dryRun: false`, the configured account, verified current signed
content, a send grant and approval bound to the reviewed MIME digest. Expiry is
rechecked after token acquisition and approval. HTTP 202 is acceptance only and
returns the deterministic Internet Message-ID as `providerRef` because Graph
returns no object ID. HTTP 400 is a definitive rejection; other statuses and
transport failures remain uncertain. The binding never retries sending.

Lookup uses a read grant and an `internetMessageId eq '…'` filter on `/me/messages`,
then verifies at most ten candidate MIME copies. Exchange-generated dates,
boundaries and transfer encodings may differ. Sender and recipient headers must
each contain exactly one pinned mailbox; bare addresses and quoted or unquoted
display names with angle brackets are accepted. Subject, Message-ID and carriage
header must still match exactly; duplicate headers and extra routing/reply
destinations are refused. Exchange's `Content-Description` metadata is allowed on
the JSON-LD attachment. STRICT parity checks every human and structured MIME
copy and requires the original signed carrier. Lookup works after expiry and
returns `found` only with positive evidence. Misses, rewritten human content or
stripped carriers return `unknown`; mail never advertises `finalAbsence`.

Graph tests use synthetic recorded response shapes and injected transports,
including 202 responses with empty bodies. No live provider or credentials are used.
Provider contracts: [delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0),
[sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

`./mastodon` exports `createMastodonReader({ instance?, accountDomain?, tokens, transport? })`,
`MASTODON_SCOPES` and default-instance `ORIGINS`. Register the OAuth app on the
configured HTTPS instance (default `https://mastodon.social`), with
`read:notifications read:statuses write:statuses`; provision separate read and
send grants through `TokenProvider`. The binding snapshots the instance and exposes
its effective `origins`. DNS pinning, single-hop transport and redirect refusal
apply to all requests. No remote status, account, media or footer URL is fetched.
The API contracts are documented by Mastodon for
[notifications](https://docs.joinmastodon.org/methods/notifications/),
[conversations](https://docs.joinmastodon.org/methods/conversations/) and
[statuses](https://docs.joinmastodon.org/methods/statuses/).

Ingest polls notifications and conversation snapshots with read grants only.
Account- and instance-scoped cursors retain the current endpoint and validated
provider `Link` pagination URL. Each request asks for one record; a call makes at
most 80 requests and respects aggregate item/byte bounds. An item that cannot fit
remains at the cursor for the next call; if it cannot fit alone, the call refuses.
Completed scans restart on the next poll. Stable IDs allow the importer to deduplicate
repeated notifications and conversation last-status snapshots. This conservative
poller does not reconstruct all historical turns from a conversation snapshot.
Deleted last statuses are skipped. Local acct handles are qualified by the trusted,
snapshotted `accountDomain` (a bare domain, defaulting to the instance host). Set it to
the server's `LOCAL_DOMAIN` when its API is served on a separate `WEB_DOMAIN`, as in
[Mastodon's split-domain configuration](https://docs.joinmastodon.org/admin/config/#web_domain).
Fully qualified remote accts retain their own domain; account domains never change
the allowed API origin or trigger requests. Parsing ignores `native`, projects HTML to plain
text, strips controls and retains raw-byte provenance. Sender claims and footer
links remain unverified observations; no structured proposal is extracted.

`./mastodon/send` exports executor-only `createMastodonSend({ instance?, account,
recipients, verify, verifyApproval, now?, transport? })`. Actor-to-acct pins are
snapshotted and must round-trip through Mastodon's outbound mention grammar after
domain normalization. Pins with ports (including explicit `:443`) are rejected at
construction because the mention parser consumes only the account before the port.
Rendering builds one recipient mention, a deterministic kind/body
summary and `AGENT_FOOTER`, refusing statuses over the existing 256-byte local
ceiling. Body `@` characters become `＠` so they cannot add recipients. Visibility
is always `direct`. Longer logical messages must use another carriage; the binding
does not truncate signed terms or raise the profile limit.

The local wire is a canonical JSON send plan (`application/vnd.jeswr.mastodon-status+json`)
containing the instance, account, compact JWS and exact `{ status, visibility }`
request. Its digest binds all those fields to owner approval. The signed evidence
stays local; Mastodon receives only the request object, so carriage remains
footer-only. Transmit re-verifies the signed payload, re-renders the plan, checks
account and validity, obtains only a send grant and requires strict owner approval.
Validity is checked again after credential and approval awaits. Sending defaults
to dry-run, with no credentials or network activity. The request uses its wire
digest as `Idempotency-Key`; there are no automatic retries. Definitive 400/401/403/404/422
responses are rejections; other failures and malformed or non-direct acknowledgements
remain uncertain. There is no lookup or final-absence claim.

The Mastodon capability descriptor advertises `federated: true`,
`endToEndEncrypted: false`, footer-only carriage, no delivery receipts, no promised
history window, and zero owner rate limits. Direct visibility still permits
federation between instances and provides no end-to-end encryption.

`./discord` exports `createDiscordReader({ tokens, gateway })`, `GATEWAY_INTENTS`,
`DISCORD_INTENTS` and `ORIGINS`. It requests exactly `GUILD_MESSAGES`,
`DIRECT_MESSAGES` and `MESSAGE_CONTENT` (37376). Enable the privileged message
content intent in Discord's developer portal and obtain approval where required.
The reader accepts bot-visible guild channels and bot DMs. It cannot read a user's
personal DM inbox; bots cannot DM users who do not share a server. These limitations
are also in the capability descriptor's `dcterms:description`. The descriptor
advertises no structured payload, no guaranteed history and zero owner allowances.

The required `DiscordGatewaySource` is a trusted host transport, with an explicit
fixed `wss://gateway.discord.gg` origin. It owns TLS/DNS pinning, Identify,
heartbeats, reconnect/resume and a bounded, replayable event buffer per account.
It receives only a read grant, the fixed intents and frozen account/bounds.
This package does not open an unguarded WebSocket or supply a socket lifecycle.
The outer cursor binds its checkpoint to an account. Batch limits include ignored
control frames and other dispatches, and oversized batches fail without advancing
the caller's cursor. `./testing` supplies `InMemoryDiscordGateway`, which snapshots
fixtures, paginates without dropping events and records no credentials.

Only `MESSAGE_CREATE` is ingested. Parsing uses the raw event bytes, validates
snowflakes and bounded JSON, strips controls, and projects content and embed
footer text into plain-text `BridgeMessage` observations. Footer URLs feed existing
legacy-bridge discovery; they are never fetched or interpreted as authority.
No embedded data is projected as a signed envelope. Channel IDs provide thread keys.

`./discord/send` exports `createDiscordSend({ account, recipients, verify,
resolveProposal, verifyApproval, footer?, now?, transport? })`. Trusted actor-to-channel
pins select existing guild or bot-DM channels; sending never opens a user DM.
Rendering verifies the signed proposal locally, emits a deterministic human summary
in `content`, the configured J2 footer in `embeds[0].footer.text`, disabled mentions,
and a provider-native nonce binding the signed proposal, rendered body and pinned destination.
No signed envelope is transmitted. `resolveProposal(wire)` must retrieve the
signed proposal from the executor's local outbox by digest so transmission can
re-derive and check all approved bytes even after a process restart.

Real sending requires `dryRun: false`, the configured account, exact wire bytes,
fresh signed content, a separate `TokenProvider.send` grant and current owner
approval. The guarded request uses `POST https://discord.com/api/v10/channels/{id}/messages`
with bot authentication, refuses redirects and never retries. Explicit client and
rate-limit refusals throw `ProviderRejectedError`; server/transport failures and
malformed acknowledgements remain uncertain. There is no lookup or `finalAbsence`.
Dry-run invokes no outbox callback, approval, credential provider or transport.

`./matrix` exports `createMatrixReader`, `createMatrixCrypto`, `parseMatrixMessage`,
`matrixOrigins` and `MatrixRoomError` (A-027 / sst-dpn). The reader pins `account`,
`homeserver` (an HTTPS origin) and `userId`. Its runtime origins are derived from that
trusted configuration; there is no homeserver discovery or redirect following.
Credentials come exclusively from `TokenProvider.read` (the matching device provider
from `@jeswr/agent-credentials/matrix` can be supplied structurally).

Each poll fetches the user's `m.direct` account data, sends its room allowlist in the
`/sync` filter, and checks it locally even if the server ignores the filter. Same-sync
`m.direct` updates supersede the snapshot; additions cause a retry from the previous
checkpoint with a fresh filter, so a newly direct room cannot lose filtered-out events. Sync responses/cursors are capped at 1 MiB,
512 pending events and 512 direct rooms; individual events are capped at 64 KiB.
The opaque account/homeserver/user cursor buffers pending ciphertext until the caller's
item and aggregate byte bounds are drained. It never advances past a failed decrypt or
malformed/truncated DM timeline: `MatrixRoomError.roomId` identifies the failed room,
and the caller must retain its previous cursor. A limited timeline requires explicit
history recovery; this binding does not silently accept gaps or auto-backfill history.
Joined and left DM timelines share these checks; a room delta without a timeline is empty.
On decryption failure, the reader synchronizes crypto changes and retries once, retaining
the pending ciphertext and delivery checkpoint. Any timelines returned during that crypto
sync are read again after pending delivery drains, so later key delivery cannot skip messages.
The live reader retains a separate crypto sync token for the blocked delivery batch,
acknowledging applied to-device messages so queued keys can continue arriving on retries.

The host initializes the Rust SDK's `OlmMachine` with the provisioned device identity
and private persistent crypto-store path, then supplies `await createMatrixCrypto(machine)`.
The adapter applies sync to-device events, device lists, key counts and fallback-key
metadata before decrypting timelines. It performs no key upload, to-device send or other
network I/O. The host owns machine shutdown and serialization of that device's sync loop.
The SDK's native library must be provisioned separately: repository policy disables its
postinstall downloader. Unit tests always use fakes; the additional real Rust session
test runs when that native library is present and explicitly skips otherwise. It uses
only a synthetic, in-memory session and no provider or real credentials.

Inbound text uses `matrix-chat-to-pod`'s `matrixEventToCanonical` before becoming a
BridgeMessage. It keeps the room as thread key, plain text and ciphertext raw digest;
HTML is never exposed as rendered content. For encrypted events, `native` is bounded
decrypted event JSON, and parsing checks its room/event/sender against the ciphertext.
Edits, redactions, media and other non-message events refuse as new text statements.
The envelope content key supplies unverified JSON-LD only; decryption and parsing grant
no agent identity or authority. `MATRIX_CONTENT` retains its exported constant name
but now advertises the brief's `matrix-event/0.1` carriage ID.

`./matrix/send` exports `createMatrixSend({ account, homeserver, userId, recipients,
bridgeRooms?, tokens, verify, verifyApproval, eventIdFor?, crypto?, footer?, now?, transport? })`.
`recipients` pins actors to rooms. The exact approved JSON wire contains the room ID,
`txnId` equal to the signed proposal ID, and deterministic `m.text` content with the
required footer and (for native Matrix rooms) `org.jeswr.agent.envelope`. The room,
transaction ID, body and carrier all participate in the digest and are re-derived
before transmission.

Real transmission requires explicit `dryRun: false`, the pinned sender account,
verified signed content, current validity, a `TokenProvider.send` grant and
`verifyApproval(wire, account) === true`. The executor must check the current mandate,
halt/limits and owner approval bound to this exact wire/account in that callback;
capability metadata is never authorization. Validity is checked again after credential
and approval awaits. Dry-run obtains no credentials and makes no requests.

This task's explicit `PUT /rooms/{id}/send/m.room.message/{proposalId}` path sends
plaintext content only. A bounded `GET /rooms/{id}/state` using the executor-supplied
send grant must confirm
the absence of `m.room.encryption`; encrypted, unreadable or unknown room state
refuses, so the binding never downgrades an encrypted room. Outbound E2EE key
distribution is outside this binding's current
send path, so its capability descriptor advertises `endToEndEncrypted: false`.
Transmit never requests `options.tokens.read` or a construction-time send grant;
both preflight and the send request use only `io.tokens.send`. Lookup remains read-only.
The provider's transaction ID supplies idempotency; this binding never
retries sends. Malformed acknowledgements and ambiguous HTTP failures remain uncertain.

Lookup obtains a known event ID from `eventIdFor(proposalId, account)`, which the
executor should supply from persisted outbox evidence. It uses only read credentials
for `GET /rooms/{id}/event/{eventId}`, requires the pinned Matrix sender and exact
reviewed content, and can use the supplied crypto adapter for encrypted copies.
Lookup remains valid after proposal expiry. Missing IDs, 404s, unreadable or changed
events return `unknown`. It never claims `absent` and leaves `finalAbsence` unset
(the contract's false value), so a miss cannot authorize another send.

### Signal and WhatsApp over Matrix (A-044 / sst-hhc)

`./matrix` also exports `detectMatrixBridge`, `describeMatrixBridge` and
`MatrixBridgeChannel` (`"signal" | "whatsapp"`). The reader recognizes mautrix ghost
MXIDs (`@signal_<id>:server`, `@whatsapp_<id>:server`, also with a leading underscore)
and `m.bridge` / legacy `uk.half-shot.bridge` room state with `content.protocol.id`
`signal` or `whatsapp`. These are unverified routing hints. Sender handles remain
Matrix MXIDs, room IDs remain thread keys, and raw event bytes remain the provenance
anchor. Double-puppeted senders are classified using room state. Conflicting,
malformed or unsupported bridge state refuses the room and retains the checkpoint.

Sync requests include bridge state and `full_state=true`, so incremental polls do
not depend on a process-local state cache. Timeline state changes apply in order;
per-event hints survive in the bounded cursor until delivery. The optional bounded
`native` JSON wrapper `{ bridge, event }` transports those hints alongside plaintext
or decrypted content without altering `raw`. Existing A-027 cursors remain readable.
The reader still imports only `m.direct` rooms; linking a bridge does not authorize
group or history ingestion. Bridged text remains an observation: any Matrix envelope
key is ignored, including one supplied by a remote user or a double puppet.

`describeMatrixBridge(channel, credentialState)` returns a descriptor with
`binding: "matrix"`, the logical channel, its `signal-footer/0.1` or
`whatsapp-footer/0.1` carriage, `structuredPayload: false` and
`endToEndEncrypted: false`. The 64 KiB limit is a local wire ceiling, not a remote
provider guarantee. Rate limits remain zero until the owner supplies authority.

For sending, configure `bridgeRooms: new Map([[roomId, "signal"]])` (or `"whatsapp"`)
alongside the existing trusted recipient pins, then render with `SIGNAL_FOOTER` or
`WHATSAPP_FOOTER`. Only the human summary and configured URL footer cross the bridge;
the compact JWS stays in the executor's reviewed local wire, outside `content`.
Validation re-derives both copies. The pre-send state check must match the pinned
bridge; native Matrix carriage to a room that becomes bridged is refused. Dry-run,
signature, freshness, current mandate/approval, credential separation and lookup
rules remain required. Matrix acceptance/lookup confirms only the Matrix event,
not remote Signal/WhatsApp delivery. Encrypted portal sends remain unsupported.

See the [hosted bridge device-linking runbook](docs/hosted-matrix-bridges.md) for A-028
setup and revocation. Tests use sanitized event-shape fixtures and fake transports;
they never link accounts or contact live messaging providers.

Google Workspace accounts reuse these Gmail factories and the `gmail` binding id.
Both factories accept `tenant: "ODI"` for ODI or `tenant: "google_workspace"` for
other managed accounts; omit it for personal Gmail. Tenant context is captured
at construction and affects setup guidance only.

`./gmail` exports `mapGmailError(error, tenant?)` and `GmailSetupRequiredError`.
An exact `admin_policy_enforced` code maps to `state: "setup-required"` and
`detail: "ask ODI admin to allow-list client id"` for ODI (otherwise Google
Workspace admin). `access_denied` maps to the same state with a consent-review
detail; it does not by itself identify an admin policy block. The mapper accepts
an exact code string or `{ error: code }`, discards provider descriptions, and
returns `undefined` for unrelated errors. A credential/OAuth integration can use
this pure mapper after validating its callback; it adds no OAuth network origins.

Read and send credential failures and HTTP 400/401/403 OAuth error bodies use the
same mapping automatically. `GmailSetupRequiredError` extends `ProviderRejectedError`
and exposes `state`, `code`, and `detail`; callers can persist the state separately
from the explanatory detail. Lookup still returns `unknown` on setup failures.
The A-036 registry importer already corrects ODI email's provider to
`google_workspace`, preserving the Microsoft provider for Teams. See the
[Workspace allow-list runbook](../../docs/runbooks/workspace-allowlist.md) for admin setup.
