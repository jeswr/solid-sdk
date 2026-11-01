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
Both `run` and `once` receive the CLI shutdown signal. Cancellation during ingestion
prevents a new outbox execution pass, while watcher cleanup and executor drain
finish under the process lease. A signal passed to `once` still runs only one pass.

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

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

<!-- AUTHORED-BY Codex GPT-6 -->

The A-042 cloud variant is **undeployed**. Build its nonroot distroless Node 24
image from the workspace root with
`docker build -f apps/agent-daemon/Containerfile -t agent-daemon:local .`.
The build uses the frozen workspace lock, disables dependency lifecycle scripts,
builds dependencies first, prunes the workspace and installs its production tree
with `--prod --frozen-lockfile --offline --ignore-scripts`. This preserves locked
resolutions without pnpm's legacy deployment, which overrides frozen-lockfile.
The runtime retains the pruned workspace layout, with `/app/bin` and `/app/dist`
symlinks preserving the derived-image contract. No credentials or host-specific
composition are baked into the base image.

The cloud executable is `bin/awp-cloud.mjs`. A reviewed derived image must copy a
trusted composition to `/app/host/compose.mjs` and run Node with
`--import /app/host/compose.mjs /app/bin/awp-cloud.mjs`. That preload imports
`configureCloud` from `/app/dist/index.js` and registers an async factory. The
factory receives `{ store, local, lease, apiKey }` and returns
`{ daemon, bindings, a2a, close }`. Construct the normal daemon with those local
state capabilities and the supplied process lease; retain all A-012 authority,
executor, outbox, audit and shutdown obligations described above. The cloud owner
acquires the file lease before composing the host and retains it through daemon
and inbound handler drain. `close` releases the pod session before that file lease
is released. No composition is inferred from the environment, downloaded, or read
from the credential mount.

`bindings` must enumerate **all** ingest and executor binding IDs. The cloud host
allows only explicit network-capable binding IDs; iMessage, linked-device Signal
and WhatsApp, MCP subprocesses and unknown bindings are refused. The host must
include `a2a` and a trusted `a2a({ body, headers, signal })` receiver returning
`{ status, body }`. The HTTP boundary forwards the exact bounded bytes and peer
authorization headers; the receiver must authenticate the peer, verify envelopes
and persist inbound data before acknowledging. It cannot grant authority or send.
It must honor cancellation. The existing A2A channel module is still a scaffold;
this task supplies the cloud hosting boundary, not a replacement protocol or a
default verifier. An absent composition/receiver fails startup.

Cloud configuration requires `AGENT_ENVIRONMENT=dev`, `AGENT_A2A_ENABLED=true`, an
absolute `AGENT_CREDENTIAL_DIR` and port `AGENT_A2A_PORT` (default 8080). Only this
explicit entrypoint opens ingress: `POST /a2a`, with JSON and a 64 KiB body limit,
plus body-free `GET /livez` and `/readyz` process probes. Probes mean the trusted
composition and ingress are available; pod authority and provider availability
still fail closed independently inside the executor. Local `awp` behavior is unchanged.

Mount a dedicated Azure Files SMB share at `/var/lib/jeswr-agent`, owned by UID/GID
65532 with `dir_mode=0700,file_mode=0600`. Existing credential-store checks remain
mandatory; an incompatible mount fails startup. Profiles, grants, cursors, proposal
results, ledger and the exclusive process lease persist across revisions. Keep one
replica and single-revision mode. A crash leaves its lease intact; prove that old
writers and provider requests are stopped before manual recovery. Never remove a
lease by age or as part of image startup. Verify SMB exclusive creation, rename
and fsync behavior before authorizing a real deployment.

ACA resolves versionless Key Vault secret references using a dedicated UAMI and
secret-scoped `Key Vault Secrets User` assignments. The factory's
`apiKey("openai" | "anthropic")` reads only the corresponding injected environment
variable. Supply it to the gateway's explicit token seam; API keys are not copied
to token-file records (whose provenance contract remains 1Password-specific).
Pod client credentials use separate ACA secret references consumed by the trusted
host's pod-auth composition. No Azure SDK, runtime 1Password call, interactive
OAuth listener, provider request or real credentials are needed to build or test.

[The GitOps handoff](deploy/gitops/README.md) contains the dev-only Bicep module and
its integration requirements. Nothing is connected to a deploy workflow. Jesse's
explicit go is required before enabling or deploying it.

CI's `agent-daemon-container` workflow builds and imports the production tree on
distroless Node 24, checks that build/test dependencies are absent, and builds the
`css-test` target. The latter runs the existing A-012 memory-CSS golden path
(private inbound data, proposal, signed approval, transmission, audit, signed halt)
and the cloud regressions inside distroless Node 24 with container networking
disabled. Locally:

```sh
docker build -f apps/agent-daemon/Containerfile --target css-test -t agent-daemon:css .
docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges agent-daemon:css
```
The [D-2 spending-limit demo](demos/README.md) exercises hostile email and A2A
fixtures, Transfer prohibition, cumulative GBP 30/day soft caps and printed audit
evidence against local CSS. Run it with `pnpm --filter @jeswr/app-agent-daemon run demo:d2`.
