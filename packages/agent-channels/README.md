<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-channels

> Experimental — AI-agent-generated. Private workspace package; Gmail defaults to dry-run.

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

Provider exports other than Gmail remain reserved for their own tasks. Packages
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
