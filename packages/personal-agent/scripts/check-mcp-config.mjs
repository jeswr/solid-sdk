#!/usr/bin/env node
// Verify an MCP client configuration (`{"mcpServers": {NAME: {command, args, env}}}`, the shape
// coding agents such as Claude Code read from `.mcp.json`) by launching EXACTLY that command
// with the official SDK client, listing the tools and reading the agent profile, then shutting
// the server down gracefully. Prints one JSON summary; exit 1 on failure.
//
//   node scripts/check-mcp-config.mjs CONFIG.json SERVER_NAME
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [configPath, serverName] = process.argv.slice(2);
const server = JSON.parse(readFileSync(configPath, "utf8")).mcpServers?.[serverName];
if (!server?.command) {
  process.stderr.write(`no stdio server ${serverName} in ${configPath}\n`);
  process.exit(64);
}
const transport = new StdioClientTransport({
  command: server.command,
  args: server.args ?? [],
  ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
  stderr: "inherit",
});
const client = new Client({ name: "awp-config-check", version: "0.1.0" });
let ok = false;
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  const r = await client.callTool({ name: "get_profile", arguments: {} });
  const profile = r.structuredContent ?? {};
  ok = !r.isError && tools.includes("propose_meeting");
  process.stdout.write(
    `${JSON.stringify({
      server: serverName,
      tools,
      actor: profile.agent?.actor,
      bindings: profile.description?.bindings?.map((b) => b.id),
      policyModule: profile.policyModule
        ? { evaluator: profile.policyModule.evaluator, status: profile.policyModule.status }
        : undefined,
    })}\n`,
  );
} catch (error) {
  process.stderr.write(`check-mcp-config: ${error.message}\n`);
} finally {
  await client.close().catch(() => undefined);
}
process.exit(ok ? 0 : 1);
