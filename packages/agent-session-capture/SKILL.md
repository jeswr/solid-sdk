---
name: agent-session-capture
description: Use when implementing or consuming @jeswr/agent-session-capture in the W9 MCP program.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-session-capture

Claude Code and Codex session capture into the pod (MCP-13 and MCP-16).

This is an MCP-01 scaffold. Read `specs/mcp/DESIGN.md` in the Solid suite planning
repository and the assigned task before adding a public API. Keep the package private,
ESM, Node >=24, and securityCritical. Document all public exports with TSDoc.

Use injected seams and recorded fixtures; never use real accounts or credentials.
Use the workspace RDF and guarded-fetch helpers. Add testing fakes under `./testing`
as behavior is implemented. Require 100% branch coverage for implemented security paths.
Run lint, build, typecheck and test through pnpm before committing.
