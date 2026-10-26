<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/app-mcp-server

> Experimental — AI-agent-generated. MCP-01 scaffold only.

Private Node >=24 ESM app. `src/handler.ts` exports a Web Request → Promise<Response>
handler; `src/index.ts` adapts it to `node:http`. All requests return 501 until MCP-11
composes the HTTP transport, OAuth, consent and health routes. No pod data is accessed.

```sh
pnpm --filter @jeswr/app-mcp-server run build
PORT=3000 pnpm --filter @jeswr/app-mcp-server start
```

The development server binds to 127.0.0.1. This task includes no deployment configuration.
