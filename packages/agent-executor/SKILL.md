---
name: agent-executor
description: Use when working on the single action enforcement point surface in @jeswr/agent-executor.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-executor

Read agent DESIGN §2 / §4.1 and README.md before changing behavior. The root exports
createExecutor, proposalTermsDigest, durable filesystem adapters and the three-attempt
bound. Contracts are in src/types.ts; explicit synthetic fakes live only in ./testing.

Preserve the nine-step order and fail closed. Halt precedes proposal/mandate reads;
proposal state never grants authority. Re-evaluate every queued item on control/mandate
change, and recheck authority after asynchronous lookup/token waits. Only verified owner
approvals and controls enter their adapter seams. Exact wire and all action terms are
approval-bound; a normal approval cannot override a prohibition or hard limit.

Accounting and claims share a store-wide lock; attempting/uncertain committed amounts
count as spent over the union of outbox and ledger. Require a signed currency for spend
limits; do not guess it to work around the stacked mandate API's missing fields.

Persist attempting with fsync before the provider call. A crash is uncertainty, never
absence. Only positive exact-wire lookup reconciles delivery. Reattempt unresolved
requests only with causal finalAbsence, or identical A2A receiver-deduplicated resend,
max three attempts. A timeout does not cancel the original request. Preserve positive
sent evidence against late failures. The host must hold a single-writer process lease.

Filesystem operations are injected to preserve the agent layer import boundary. Do not
add raw provider/network/model access or expose a read token through the send projection.
Audit entries contain digests and references, never message bodies, tokens or provider
error text. Surface durability/audit failures; never treat missing audit reads as zero use.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Maintain 100% per-file branches/functions/lines/statements coverage,
including actual durable crash/restart and adversarial asynchronous cases.

Never use live providers or credentials in tests. Send implementations belong exclusively
in channel send subpaths, importable only by agent-executor and channel tests. Only
agent-model-gateway may import OpenAI or Anthropic SDKs; it must never import agent-audit.
