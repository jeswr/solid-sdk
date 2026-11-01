<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-channels

> Experimental — AI-agent-generated. Private workspace package; Gmail and Matrix default to dry-run.

Channel contracts, carriage profiles, capability RDF and origin enforcement for DESIGN §3
(A-005 / sst-31t), plus email MIME and Gmail REST (A-006 / sst-dez) and shared metadata carriage
(A-014 / sst-wxu). The `ChannelBinding` and `CarriageProfile` declarations follow §3.1.

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

The test factory takes `{ tokens, verify, now? }`. `verify` must be a pure local
signature verifier returning the protected Message after checking the pinned key
and intended audience. Missing/unverifiable messages fail closed. Rendering is
deterministic; validation and transmission enforce freshness. Lookup may reconcile
an accepted message after expiry, using exact bytes as positive evidence.
Parsed BridgeMessages carry unverified JSON-LD; parsing confers no authority.

`transmit(wire, { account, tokens, dryRun? })` defaults to dry-run. Explicit
`dryRun: false` delivers only to the isolated in-memory inbox selected by `account`;
there is no network transport. Read paths request only `tokens.read(account)`;
send paths request only `tokens.send(account)`. Grants carry distinct `access`
discriminants and nonempty tokens. The recording provider uses distinct fake grants.
Pagination is account-scoped, bounded by total bytes and item count, and fails when
the next item cannot fit. Exact repeated sends are idempotent; conflicting bytes
or destination accounts are refused. Lookup has `finalAbsence: true`.

All DESIGN §3.2 rows have frozen constants in `CARRIAGE_PROFILES`. Only email's
25,000,000-byte limit is specified there. Other structured profiles use the pilot's
64 KiB local ceiling; footer-only profiles conservatively cap at 256 bytes pending
their binding tasks. LinkedIn/X have zero-byte read-only profiles. No profile
constant implements sending. The direct descriptor advertises zero owner rate
limits by default; it is a capability statement, never permission to send.

Provider exports other than Gmail and Matrix remain reserved for their own tasks. Packages
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
Validity is rechecked after credentials and approval await. Dry-run requests no
credentials and makes no network call.

Transmit uses `users.messages.send` with the reviewed MIME as canonical base64url.
HTTP 400 is a definitive `ProviderRejectedError`; other failures or a malformed
acknowledgement remain uncertain. This binding performs no send retries. Lookup
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
tokens, verify, verifyApproval, eventIdFor?, crypto?, footer?, now?, transport? })`.
`recipients` pins actors to rooms. The exact approved JSON wire contains the room ID,
`txnId` equal to the signed proposal ID, and deterministic `m.text` content with the
required footer and `org.jeswr.agent.envelope`. The room, transaction ID, body and
carrier all participate in the digest and are re-derived before transmission.

Real transmission requires explicit `dryRun: false`, the pinned sender account,
verified signed content, current validity, a `TokenProvider.send` grant and
`verifyApproval(wire, account) === true`. The executor must check the current mandate,
halt/limits and owner approval bound to this exact wire/account in that callback;
capability metadata is never authorization. Validity is checked again after credential
and approval awaits. Dry-run obtains no credentials and makes no requests.

This task's explicit `PUT /rooms/{id}/send/m.room.message/{proposalId}` path sends
plaintext content only. A read-grant check of `m.room.encryption` must return 404;
encrypted, unreadable or unknown room state refuses, so the binding never downgrades
an encrypted room. Outbound E2EE key distribution is outside this binding's current
send path. The provider's transaction ID supplies idempotency; this binding never
retries sends. Malformed acknowledgements and ambiguous HTTP failures remain uncertain.

Lookup obtains a known event ID from `eventIdFor(proposalId, account)`, which the
executor should supply from persisted outbox evidence. It uses only read credentials
for `GET /rooms/{id}/event/{eventId}`, requires the pinned Matrix sender and exact
reviewed content, and can use the supplied crypto adapter for encrypted copies.
Lookup remains valid after proposal expiry. Missing IDs, 404s, unreadable or changed
events return `unknown`. It never claims `absent` and leaves `finalAbsence` unset
(the contract's false value), so a miss cannot authorize another send.
