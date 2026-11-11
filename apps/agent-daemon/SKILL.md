---
name: agent-daemon
description: Use when working on the host-neutral daemon composition, scheduler, control watcher, awp CLI, task instrumentation, offline statistics or launchd installer in @jeswr/app-agent-daemon.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/app-agent-daemon

A-012 implements the host-neutral daemon and CLI. Read agent DESIGN §2 / §6 / §9.1 and
README.md before changing behavior. Root exports the runtime, pod workspace,
local state, process lease, CLI composition and installer. `./testing` contains
only ephemeral synthetic state and an SDK memory StorageClient with a fetch adapter.

Inject a Solid `storage: StorageClient` into `PodWorkspace`; `composeDaemon` shares the
single root-entry `createPodClient({ fetch: auth.fetch, storage })` result with
notifications. Workspace operations use that client. Retain the scoped `io` seam
for the legacy importer. Use `createMemoryPod(root?).storage` for offline workspace
tests; its fetch adapter, request records and resource snapshots share the SDK state.
The constructor refuses non-Solid clients. Workspace and memory fetch-adapter creates
use `createAt` from `@jeswr/storage-client/helpers` so URL encoding mismatches fail
before creation. Use canonical encoded child names (`x%3Ay.ttl`, not `x:y.ttl` or
`x%3ay.ttl`). Replay/retry only remapped name-taken 412s; real 409s fail. Container
creation conflicts require a confirming HEAD before provisioning continues.
The memory adapter translates the SDK memory backend's 409 to HTTP Solid's 412
only after HEAD confirms that exact named target exists; kind collisions retain 409.

Use pod-auth/node client-credentials DPoP fetch for pod access. Keep the trusted
host composition explicit. No credentials, provider implementations or account
permissions may be inferred from model output or unverified pod statements.
Executor controls/approvals/mandates must verify owner proofs; structural parsing
never grants authority. Channel send imports remain executor-only.

Keep owner-only ACLs before content, bounded ingestion, per-account cursor commits
after persistence, deterministic-first Reader extraction, and Proposer eligibility
restricted to owner flags or structured envelopes. Proposals remain proposed and
inside proposals/; conflicting rewrites fail. The model never writes audit.

Maintain 30-second authority reconciliation independent of ingest and 60-second
heartbeat writes. Every detected approval/control availability change must invoke
the executor's invalidation hooks synchronously, including removals and resync.
Hold the exclusive process lease through watcher cleanup and executor drain.
Never reclaim a crashed lease by age. No default inbound server; only explicit
credential login may open its PKCE loopback listener.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
A-042 adds the separate, opt-in cloud entrypoint `bin/awp-cloud.mjs`. Read the
README cloud contract and `deploy/gitops/README.md` before editing it. Only a
trusted image-baked preload may configure its A2A receiver. Keep dev-only settings,
bounded ingress, explicit cloud binding allowlist, UID 65532 owner-only Files
storage, Key Vault/UAMI secret references, and complete shutdown drain. The normal
CLI still has no inbound server. The A2A protocol remains a trusted host seam.
The GitOps files are an undeployed handoff; never deploy or enable without Jesse's go.

Installer confirmation precedes all filesystem writes. Refuse existing plist files
and symlinks; never load launchd automatically. Logs exclude bodies and secret or
provider exception text, and redact paths and WebIDs. No runtime 1Password calls.

Follow ADR-001 D4: Node >=24, ESM, workspace dependencies, strict TypeScript, Biome
and Vitest. Never use live providers or real credentials in tests. Preserve the
loopback-only memory CSS fixture with synthetic identities and real WAC checks.
Run app lint/build/typecheck/tests and the repository gate before the last commit.

<!-- AUTHORED-BY Codex GPT-6 -->
A-045 adds TaskRecorder and offline awp stats exports to the implemented daemon.
Preserve body-free projection, trusted task context, read-only stats and scrubbed
CLI failures. Keep task context runtime-owned; model output never chooses it.
Stats verify retained evidence, report pruning and unassigned entries, and never
authenticate, append, rotate, prune or contact a provider. `--ledger` works without
a configured host; default stats use only the host's existing local ledger.
The normal daemon derives stable task labels before model invocation from account,
import location and raw digest, and stamps TaskContext on successful/failed model
calls and proposal evidence. Preserve replay identities independently of model output.
Unassigned legacy counters remain visible separately in JSON and CSV statistics.
