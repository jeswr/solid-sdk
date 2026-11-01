<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-channels

> Experimental — AI-agent-generated. Private workspace package; Gmail defaults to dry-run.

Channel contracts, carriage profiles, capability RDF and origin enforcement for DESIGN §3
(A-005 / sst-31t), plus email MIME and Gmail REST (A-006 / sst-dez). The `ChannelBinding` and `CarriageProfile` declarations follow §3.1.

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
The root's pure `readEnvelope(raw)` validator is also used for daemon eligibility.
It applies the same 64 KiB byte and compact-JWS string bounds as the direct parser.

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

Gmail and the optional read-only X binding are implemented. Other provider exports
remain reserved for their own tasks. Packages remain private per ADR-001 D5.

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

The remaining provider exports remain reserved for their own tasks. Packages
remain private per ADR-001 D5.

Run `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, and `pnpm run test` here.

Tests enforce 100% coverage per source file in every metric, with real local
Ed25519 signatures, adversarial inputs, a loopback HTTP server and a Turtle golden.

`./email-mime` implements the pilot's bounded MIME inspection and provider-copy
verification. The caller injects legacy-bridge's `parseEmail` function; this keeps
its hardened parser and avoids reversing legacy-bridge's dependency on channels.
`inspectEmail(raw, { parseEmail, recipient, ownAccounts, footer })` returns the
BridgeMessage, unverified structured proposal and parity result. The trusted
receiving account selects STRICT parity when it is in `ownAccounts`, otherwise
LENIENT parity. An unauthenticated `To` header cannot select a weaker mode.
Plain human email remains an observation. Conflicting carriers always fail closed;
parsing and parity never confer verified identity or authority.
Before returning a proposal, inspection checks every JSON-LD part and HTML script
carrier in the bounded MIME tree, including copies omitted by the legacy parser's
caps. Incomplete extraction or unparseable JSON-LD refuses the proposal in both modes.

`./email-mime/send` exports `createEmailRenderer({ from, recipients, footer,
verify, now? })`. `recipients` pins actor identifiers to single mailboxes; no
inbound Reply-To or model-selected address is used. The pure local `verify`
callback verifies the compact JWS, sender key and intended audience. Rendering
preserves the pilot's deterministic synthetic-test summary and appends the
configured single-line footer (normally `AGENT_FOOTER`). MIME has plain text,
HTML with an inline JSON-LD carrier, a matching `application/ld+json` attachment,
and `X-Agentic-Reply: 1`. Its date and boundaries are derived from protected
content, so rendering and validation re-derive identical bytes. Validation checks
the entire MIME and digest, refusing extra recipients, changed headers or content.
The pilot's 512 KiB local MIME ceiling remains stricter than email's advertised
25,000,000-byte provider profile. MIME itself has no transmit method.


`./gmail` exports `ORIGINS` and `createGmailReader({ tokens, parseEmail, recipient,
ownAccounts, footer, transport? })`. Reads use only `TokenProvider.read`. The
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
