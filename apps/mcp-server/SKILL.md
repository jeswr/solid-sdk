---
name: mcp-server
description: Use when implementing the Node composition app for the W9 MCP server.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP server composition

Read the W9 `specs/mcp/DESIGN.md` and MCP-11 task in the planning repository before
composing transports, OAuth or consent. This is a private Node >=24 ESM app, with a
plain node:http entry and an exported Web Request → Promise<Response> handler.
The current 501 handler deliberately exposes no data or MCP behavior.

Internal dependencies must use workspace:*. Use fixtures and injected services in tests.
Run lint, build, typecheck and test through pnpm. Do not deploy or publish from this task.
