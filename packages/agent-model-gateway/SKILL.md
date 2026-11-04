---
name: agent-model-gateway
description: Use when working on the reader and proposer model gateway surface in @jeswr/agent-model-gateway.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-model-gateway

A-011 implements createGateway, Reader extraction, Proposer tools and caller-owned model
call counters. Read agent DESIGN §2 and §6 and the README before changing behavior.
The root is the runtime API; `./testing` contains only synthetic provider fakes.
Keep origins provider-pinned, Reader tool-free, Proposer restricted to the four declared
tools, and credentials behind TokenProvider.read. The gateway never persists audit or proposals.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Maintain 100% branches/functions/lines/statements coverage.

Never use live providers or credentials in tests. Future fake implementations belong
in `./testing`. Send implementations belong exclusively in channel send subpaths,
importable only by agent-executor and channel tests. Only agent-model-gateway may
import OpenAI or Anthropic SDKs; the gateway must never import agent-audit.
