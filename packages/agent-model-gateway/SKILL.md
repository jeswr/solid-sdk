---
name: agent-model-gateway
description: Use when working on the reader and proposer model gateway surface in @jeswr/agent-model-gateway.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-model-gateway

This is the A-003 scaffold, not an implemented API. Read the agent DESIGN §2 and the
package README before adding behavior. Root and `./testing` modules are reserved.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Maintain 100% branches/functions/lines/statements coverage.

Never use live providers or credentials in tests. Future fake implementations belong
in `./testing`. Send implementations belong exclusively in channel send subpaths,
importable only by agent-executor and channel tests. Only agent-model-gateway may
import OpenAI or Anthropic SDKs; the gateway must never import agent-audit.
