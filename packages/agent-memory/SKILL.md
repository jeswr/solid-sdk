---
name: agent-memory
description: Use when working on the personal knowledge graph memory hooks surface in @jeswr/agent-memory.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-memory

This is the A-003 scaffold, not an implemented API. Read the agent DESIGN §2 and the
package README before adding behavior. Root and `./testing` modules are reserved.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. 

Never use live providers or credentials in tests. Future fake implementations belong
in `./testing`. Send implementations belong exclusively in channel send subpaths,
importable only by agent-executor and channel tests. Only agent-model-gateway may
import OpenAI or Anthropic SDKs; the gateway must never import agent-audit.
