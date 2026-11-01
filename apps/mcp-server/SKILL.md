---
name: mcp-server
description: Use when implementing the Node composition app for the W9 MCP server.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# MCP server composition

Read the W9 `specs/mcp/DESIGN.md` and MCP-11 task in the planning repository before
composing transports, OAuth or consent. This is a private Node >=24 ESM app, with a
plain node:http entry and an exported Web Request → Promise<Response> handler.
The app composes the existing MCP HTTP transport, OAuth core, encrypted atomic vault,
and broker sessions. Browser completion requires the flow cookie, callback state,
same-origin form POST and single-use CSRF-protected consent. Never expose the core's
trusted authorize seam as an unauthenticated route. OAuth records and the signing key
share the vault; Vercel requires shared KV. Single-user mode requires a separate MCP
bearer and keeps CSS DPoP credentials server-side. Preserve read-only defaults.

Internal dependencies must use workspace:*. Use fixtures and injected services in tests.
Run lint, build, typecheck and test through pnpm. Do not deploy or publish from this task.
