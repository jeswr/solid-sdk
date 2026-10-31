<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-executor

> Experimental, security-critical, private workspace package. No live provider adapters.

The deterministic action enforcement point (DESIGN §4.1, A-009 / sst-0al).
`createExecutor(options)` accepts trusted proposal/outbox, approval, mandate, policy,
control, clock, transmission-store, send-token and audit adapters, plus a registry of
channel **send halves**. It imports no model SDK or channel ingest implementation.

`transmit(proposalId)` runs the nine-step gate: local/verified halt, exact rendered-wire
integrity, expiry, current verified mandate and policy, exact verified approval when
required, committed limits, durable idempotency, provider outcome and conversation receipt.
Actor-writable proposal state never grants permission or controls idempotency. Dry-run
is the default; both the executor and binding must explicitly enable effects.

`runOutboxOnce()` processes the trusted outbox queue. The daemon must call
`onControlOrMandateChange()` on **every** notification or polling-detected change in
control statements or mandate/status. It re-evaluates every queued item without sending.
Every later attempt evaluates again. Halt, policy and proposal checks also run after
lookup and before handing over send credentials, closing asynchronous revocation races.

## Trust and adapter requirements

- `ApprovalStore.findVerified(context)` must use `agent-mandate.verifyApproval` (or an
  equivalent verified adapter) against the supplied owner WebID, proposal, terms digest
  and clock. It must never return parsed-but-unverified approvals. The executor also
  checks proposal/digest/expiry/decision and gives a verified denial precedence.
- `ControlStore.listVerified(ownerWebId)` must return only owner-proof-verified controls.
  Future, expired and wrong-owner records are ignored. An active Halt wins timestamp
  ties; a later verified Resume clears it only when the local HALT file is absent.
  Unreadable controls or HALT state fail closed. `createHaltFileCheck(io, path)` checks
  the real file on every pass, including dangling symlinks; only ENOENT means absent.
- `ProposalStore` writes executor-owned outbox dispositions and idempotently upserts
  conversation receipt messages. `queued()` must enumerate all pending and unresolved
  items, including those waiting for approval or control/mandate re-evaluation.
  Send/receipt/audit persistence errors propagate; an audit failure never authorizes a send.
- `proposalTermsDigest(entry)` defines approval identity. Build the wire first, set
  `wireDigest`, then set `proposal.intent.termsDigest` using this helper before approval.
  It covers the complete intent except the digest itself, proposal id, preview, expiry,
  signed carrier, account, wire digest and media type. Changing any term invalidates old approvals.
- The binding's `send.validate(wire, { renderable, intent, account })` must verify that
  every intent term (including recipient, operation, parameters, purpose and amount) and
  the sending account describe the signed carrier and actual destination. It runs before
  policy or accounting. A channel's renderable-only validator needs a trusted adapter
  implementing these additional checks. Bindings are trusted code, created only from
  their `/send` exports.
  The executor supplies a send-only TokenProvider projection; wrong-account requests,
  wrong-scope/empty grants and grants resolved after revocation fail closed.
- `AuditSink` is system-only and must retain historical transmission accounting records.
  Entries contain identifiers/digests, authorization references and outcomes, never
  proposal bodies, provider error text or tokens. `drain()` waits for late settlement
  writes and exposes any background audit/persistence failure.

## Durable transmission and recovery

One executor-owned record per proposal: `attempting → sent | not-sent | uncertain`.
`TransmissionStore.exclusive` serializes decisions, accounting and claims across all
users of that store. `put` must atomically replace and **fsync before resolving**.
The provider is called only after the durable attempt and audit writes succeed.
The daemon must also hold a single-writer process lease throughout provider calls;
a short transaction lock cannot fence another live process's pending request.

`createFileTransmissionStore({ io, directory, exclusive })` implements atomic local
replacement, file fsync and directory fsync using an injected `fs/promises`-compatible
filesystem. Supply a private daemon directory and the store-wide lock. Files are created
0600, new directories 0700. Corrupt/unreadable storage never becomes empty history.
It stores transmission metadata and committed amounts, with no bodies or credentials.
The separate `./testing` export provides explicit in-memory, non-durable seams only.

After a crash, `attempting` is unresolved. Only positive exact-wire `lookup()` evidence
can reconcile it as sent; a search miss cannot authorize a retry. `finalAbsence: true`
permits a retry only if the binding guarantees the old operation did not execute and
cannot later complete. Identical unresolved resend is allowed exclusively for binding
id `a2a` with `idempotentResend: true` and receiver deduplication. All paths are bounded
at **three provider attempts**. Rejected A2A resends retain the earlier uncertainty.

Timeouts do not cancel the original call. Pending requests remain guarded across
executor instances sharing a store, and late outcomes are persisted. Positive delivery
evidence cannot be downgraded by a late rejection. `sent` history in either the local
store or audit ledger prevents another send, including after local-store compaction.
An operator may resolve an uncertain record through the trusted store; an ordinary
approval or a forged proposal state is not evidence of non-delivery.

## Accounting

Limits use the union of outbox transmission records and ledger history, deduplicated by
proposal id. Attempting, uncertain and sent obligations count their **committed** amounts;
not-sent obligations are released. Retries replace their own reservation. Conflicting or
corrupt accounting records fail closed. Checks and new reservations share the claim lock. Amounts are summed as exact decimal
JSON-number values, so binary floating-point rounding cannot erase a commitment. A retry
after a definitive non-send reserves against its new commitment time.

Per-recipient contact rate uses rolling 24 hours; global sends/day and spending/day,
week and month use UTC calendar boundaries (week starts Monday). Hard breaches refuse;
soft breaches requeue as `confirm-required` with a reason. A normal action approval does
not bypass a breached cap: usage or the owner's signed mandate must change first.

The stacked A-008 mandate API currently exports daily/weekly spend operands but lacks
`spendPerMonth` and a signed currency field. The executor understands the monthly operand
and `AccountingMandate.currency` only when supplied by a verifier that authenticates
those fields. Existing VC verification does not emit these extensions. A spend limit
without an authenticated matching currency fails closed; mixed-currency obligations
require confirmation/refusal according to the signed limit's soft/hard setting. No FX
conversion or guessed currency is used, and this lane does not alter agent-mandate.

Run the package's lint, dependency-first build, typecheck and test scripts, and root gates.
Tests enforce 100% per-file branches/functions/lines/statements, exercise real fsync and
process death, and exhaustively check 256 halt/resume/file control sequences. They use
synthetic identities and injected provider transports only.
