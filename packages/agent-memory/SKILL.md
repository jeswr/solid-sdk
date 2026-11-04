---
name: agent-memory
description: Use when implementing or consuming scoped PKG recall, approval-gated remember and communication-rule imports in @jeswr/agent-memory.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-memory

Read README.md and agent DESIGN §7 before changing behavior. Reuse @jeswr/pkg-memory
for the existing Python-compatible builder; do not fork its UUIDv5 or graph logic.
The root exports createAgentMemory, DEFAULT_MEMORY_SCOPE and types. ./testing
exports the explicit createMemoryApprovalQueue fake.

The host supplies an authenticated Solid StorageClient, existing owner-private
memory/pending containers, a verified/revocation-checked MemoryMandate loader,
an authoritative approval-key resolver, a durable idempotent approval queue and
the canonical KG SHACL shapes. Do not infer signed memoryScope from unsigned
configuration or model input. Purpose policy belongs in the host loader.

Recall requires Current status, no elapsed invalidation and every category in the
current scope. An absent scope defaults to exact pd:Preference; an empty scope
means none. Never expose excluded sibling graphs, source graphs or pending data.
Keep listing/body bounds and direct containment checks.

Origin classification is trusted host context. Only owner-typed conversation
claims are SelfReportedExplicit. Everything inferred requires a rule plan. Every
remember and one-time YAML import is staged and approval-gated. YAML import is
strict rules: [{id, rule}], with a full source revision and synthetic tests only.

Verify real signed owner approvals against exact staged bytes and destination;
a valid deny is a refusal. Validate with real rdf-engine (or injected equivalent)
before conditional copy/delete, checking approval expiry again after validation.
Never default to a conforming fake validator or fetch shapes implicitly. Preserve
conflicting targets and pending edits. Document copy/delete partial completion.

Use Node >=24, ESM exports, workspace deps, Biome and Vitest. Keep regressions for
scope/privacy, provenance, signed approvals, real SHACL, race/retry behavior and
local CSS. Never call live providers or pods or use real credentials in tests.
