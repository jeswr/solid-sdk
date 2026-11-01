---
name: agent-daemon
description: Use when working on the host-neutral daemon composition surface in @jeswr/app-agent-daemon.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/app-agent-daemon

Read agent DESIGN §2 / §6 / §9 and the package README before adding behavior.
The root exposes A-045's TaskRecorder and offline awp stats CLI; host lifecycle
composition and the `./testing` module are reserved. Preserve body-free projection,
trusted task context, read-only stats and scrubbed CLI failures.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. 

Never use live providers or credentials in tests. Future fake implementations belong
in `./testing`. Send implementations belong exclusively in channel send subpaths,
importable only by agent-executor and channel tests. Only agent-model-gateway may
import OpenAI or Anthropic SDKs; the gateway must never import agent-audit.
