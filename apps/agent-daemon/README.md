<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/app-agent-daemon

Experimental, private Node 24 ESM application for A-012 / sst-wpz. The pod connects
its Reader, Proposer, executor and UI. Default operation opens no listening port.
Explicit `login` uses the credential package's PKCE loopback listener.

`composeDaemon` obtains a client-credentials DPoP session through
`@jeswr/pod-auth/node`, creates the storage client and notifications client using
that session's fetch, and calls a trusted `prepare(workspace)` host factory.
Credentials stay in pod-auth. The factory supplies explicit accounts, a gateway,
an executor, verified authority stores, an audit writer and durable local state.
`createDaemon` accepts the same already-composed capabilities for embedded hosts
and offline tests. No provider, account or permission is inferred from pod content.

The deployment supplies the owner-discovered private Type Index URL (already linked
from the owner's preferences document). Registration preserves existing RDF and
uses ETags, retries at most three conflicts, and refuses unreadable indexes or
missing validators. A missing index is created owner-private. The registration
uses `solid:instance` to identify `<storage>/agent/` as `agent:AgentWorkspace`.
Provisioning the preferences/profile links remains the host's responsibility.

Each enabled account is processed serially, including accounts sharing a binding:

1. List within item/byte bounds from its durable cursor.
2. Import through M1 `importInbound`: owner-only ACL before raw bytes, provenance
   graph and canonical chat data. Account inboxes are separated under
   `agent/inbox/<binding>/<opaque-account>/`.
3. Run the gateway Reader's deterministic-first triage schema and persist the result.
4. Call the Proposer only for independently owner-flagged threads or structured
   JSON-LD envelopes. Neither condition establishes identity or authority. Its
   context supplies the gateway's read-only pod and memory tools.
5. Stamp and create proposals only inside `agent/proposals/`; an identical replay
   is safe, but a conflicting rewrite fails. Save each stamped Proposer result in
   durable local `proposalResults` before outbox projection. Replace that cache with
   the trusted outbox's finalized proposals before pod publication or model counters,
   and reuse it when a batch retries, including empty results. Commit the ingest
   cursor only after the entire batch succeeds.
6. Run the executor's outbox pass. It alone owns send capabilities and credentials.

Email polls every 120 seconds, chat every 30, social every 300. The control watcher
subscribes to `agent/control/` and `agent/approvals/` through pod-notifications with
30-second polling fallback. An independent 30-second reconciliation also covers
edits/removals missed by container push. Hooks invalidate in-flight executor
snapshots immediately on hints, resync and loss of notification availability.
Heartbeat RDF is written at startup and every 60 seconds to
`agent/control/heartbeat.ttl`, including while ingest is suspended.

The host must construct the executor with fresh, cryptographically verified owner
controls, approvals and mandates: parsing RDF is insufficient. Its local HALT check
must read `createLocalState(...).halted` on every gate pass. Wire/action validation,
exact approval terms, accounting, durable transmissions and send adapters remain
executor obligations. `proposalWritten` runs before pod publication and must
idempotently project proposals into the trusted outbox, returning the exact
`OutboxEntry` used by the executor with `proposal.intent.termsDigest` set using
`proposalTermsDigest(entry)`. The daemon checks that digest and durably caches the
finalized proposal before publishing the same proposal to the pod and audit.
The hook must never send or grant approval. The daemon derives body-free evidence
with `proposalApprovalTerms(entry)` from agent-executor, including account-bound
recipient hashes, the exact wire digest and a hash committing the full private
proposal, carrier and expiry. It records `digestOf(terms)`, matching the executor's
approval digest. Its audit adapter supplies `append`, `entries` from that same durable ledger, and `sync` to
retry mirroring existing evidence without appending duplicate records. For an
`AuditWriter`, use `entries: () => ledger.entries()` and
`sync: () => mirror.sync(ledger.entries())`. The daemon never imports a channel
send subpath or a model SDK.

`createProcessLease(directory)` creates a private exclusive process lease and
holds it through executor drain, including timed-out provider requests. Crash
leases are intentionally not stolen: establish that all previous writers and
provider calls have stopped before operator recovery. `createLocalState(directory)`
provides atomic fsynced cursors and proposal results, local HALT and safe status.
Retain proposal results across cursor retries and process restarts. Use a dedicated
private credential-store directory whose parent already exists.

The `awp` executable dispatches `run`, `once`, `halt`, `status`, `accounts`,
`login <profile>`, `stats [--task <proposal-id>]`, `audit <artifact> [--at <instant>]`
and `install-launchd`. `createCliHost` connects those commands to a daemon or lazy composition factory,
local state, credential helper and ledger. Prefer a lazy factory: local commands never
authenticate, and run/once close the pod session after draining. Task statistics filter proposal-associated
model calls; Reader calls and calls producing several proposals remain in global
counts. Audit delegates to agent-audit's independent anonymous verifier.

A trusted local Node preload calls `configureCli(host)` before the executable:

```sh
node --import /absolute/private/compose.mjs apps/agent-daemon/bin/awp.mjs run
node --import /absolute/private/compose.mjs apps/agent-daemon/bin/awp.mjs once
node --import /absolute/private/compose.mjs apps/agent-daemon/bin/awp.mjs halt
```

This explicit composition is required because the stacked registry remains a
scaffold, and channel send factories are executor-only. An unconfigured CLI fails
closed; it does not guess credentials or install a default sending host. Preloads
must be inert until a command needs their capabilities; keep secrets out of argv,
logs, plist arguments and source control. No deployment module is downloaded or
loaded from pod data.

`install-launchd` asks before any writes. On macOS it creates
`~/Library/LaunchAgents/org.jeswr.agent.plist` with KeepAlive, RunAtLoad, private
umask and logs under `~/Library/Logs/jeswr-agent/`. Supply an absolute Node command
including the trusted preload, executable and `run` argument. It refuses an
existing plist or symlink and does not load the job. Noninteractive invocations
cancel. Operational errors discard arbitrary exception text; command output and
logs redact paths, WebIDs and addresses. OAuth authorization URLs go only to the
host's explicit browser opener, never to its logger.

Run the app's `lint`, `build`, `typecheck`, `test`, then the repository gate. Tests
use synthetic credentials, generated keys and an isolated memory-backed CSS 7.2
fixture with debug identities and real WAC checks. The fixture is loopback-only;
its debug authentication is never used by production composition. The suite covers
private ingestion, deterministic triage, proposal eligibility, signed approval and
halt, executor transmission, audit mirroring, scheduler and shutdown races, CLI
validation and confirmation-gated plist creation. On macOS the installer test also
runs `plutil -lint`; elsewhere Python plistlib validates the XML plist.
