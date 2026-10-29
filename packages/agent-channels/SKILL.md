---
name: agent-channels
description: Use when working on the channel bindings and carriage profiles surface in @jeswr/agent-channels.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-channels

Read agent DESIGN §2–3 and the package README before changing behavior. A-005
implements the contracts, shared legacy message/adapter shapes, frozen carriage
profiles, capability RDF, guarded origins and the in-memory direct test binding.
Provider modules remain reserved for their individual tasks.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Maintain 100% branches/functions/lines/statements coverage.

Never use live providers or credentials in tests. Fakes belong in `./testing`;
production imports of that surface fail layer lint. Send implementations belong
exclusively in channel send subpaths, importable only by agent-executor and channel
tests. The guard permits only testing.ts's direct/send factory re-export for
test composition. Read credentials come only from TokenProvider.read; send
credentials come only from TokenProvider.send. Sending defaults to dry-run.
The direct verifier is injected, local and pure; parsing never verifies signatures.
Reuse agent-model's capability record mapping rather than minting duplicate terms.
Only agent-model-gateway may
import OpenAI or Anthropic SDKs; the gateway must never import agent-audit.
