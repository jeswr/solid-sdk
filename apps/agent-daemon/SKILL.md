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
`x%3ay.ttl`). `proposalLocation` accepts only IDs passing the shared `isExactChildUrl`
predicate as direct `.ttl` children of `proposals/`; all other IDs use a deterministic
digest location. Before outbox projection, repair and persist cached legacy IDs through
the same rule without invoking the Proposer again, only when neither ledger evidence
(model-call or proposal records) nor a legacy-URL resource shows an earlier projection.
Otherwise keep the legacy ID end to end; an unpublished one fails closed for manual
migration. Never project one proposal under two IDs.
Replay/retry only remapped name-taken 412s; real 409s fail. Container
creation conflicts require a confirming HEAD before provisioning continues.
The memory adapter forwards the SDK memory backend's exact name-taken 412 directly;
kind collisions retain 409.

Use pod-auth/node client-credentials DPoP fetch for pod access. Keep the trusted
host composition explicit. No credentials, provider implementations or account
permissions may be inferred from model output or unverified pod statements.
Executor controls/approvals/mandates must verify owner proofs; structural parsing
never grants authority. Channel send imports remain executor-only.
Wire local.halted and local.assertNotHalted into the executor's asynchronous gate and
synchronous dispatch fence. CLI resume uses the same verified control adapter and
removes HALT only after a fresh signed owner Resume; never parse a control as authority.
The Resume must be signed after the local stop: compare its browser timestamp strictly
with the later of HALT's recorded `halted <ISO time>` and its modification time, check
authorisation again under halt.lock, keep a HALT with no readable time, and reject
future statements. HALT stops new dispatches once visible; it is not atomic with an
in-flight send in another process (do not claim otherwise).
Clock skew between devices can delay or refuse resume; refusal is the safe direction.
Halt atomically writes mode-0600 HALT without a lock. Only Resume takes halt.lock;
both local fences treat that lock as stopped during removal. Preserve a racing Halt
by checking the removed identity and rechecking after unlink. A crashed Resume lock
requires operator recovery after establishing quiescence; it must never block Halt.

Keep owner-only ACLs before content, bounded ingestion, per-account cursor commits
after persistence, deterministic-first Reader extraction, and Proposer eligibility
restricted to owner flags or admitted messages. Supply the gate label to both models.
Proposals remain proposed and
inside proposals/; conflicting rewrites fail. The model never writes audit.

Every host supplies an inbound gate. Use `createInboundGate` for a durable
`<stateDirectory>/gate/` runtime under the process lease. Open after acquiring
the lease and close after executor drain. Batch-check all parsed messages before
the importer can write an ACL. A failed startup/check prevents inbox writes,
model calls and cursor advancement. Store verdicts locally and keep pod inbox
identity unverified. Plain observations may be triaged and require an owner flag
for Proposer access. Preserve the independent executor mandate and keep the
reference mandate deny-all through Phase 2.

Compose `DaemonOptions.memory` with `createRuntimeMemory`, the leased gate's
`facts` method, scoped `createAgentMemory` recall and a trusted purpose IRI. The
daemon installs the Proposer's `memoryRecall` callback. Model text is a literal
substring filter after authorization. Keep complete provenance, count
superseded and other-purpose facts without exposing their content, and bound
the final JSON. Provision memory and pending containers under the workspace's
owner-only ACL. The reference task, reliance policy, source rules and handlers
come from trusted host configuration. Preserve the gate's own persistent state
across restarts. Use `createTestMemory` for fixtures that have no owner mandate.

`awp gate init --owner-dir <dir>` confirms creation and keeps the owner key in
separate custody. `awp gate pin <card.json>` checks both declared thumbprints and
requires an out-of-band comparison through the operator. Only the operator
can add peers. `awp gate status` displays pins, ledger integrity, counts and
interrupted digests without message content or signing material.

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
