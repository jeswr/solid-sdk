#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
// `agent-sandbox-mcp`: serve the Harbour & Finch demo world over MCP stdio, behind the gate.
// Add it to an MCP client to watch a real agent work within the rules:
//   { "command": "npx", "args": ["agent-sandbox-mcp", "--story", "injected-refund"] }
// Every decision is written to stderr as one JSON line (stdout carries the MCP protocol).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWorldSandbox } from "../runners/story.js";
import type { EnforcementMode } from "../types.js";
import { SCENARIOS, scenario } from "../world/scenarios.js";
import { createMcpProxy } from "./proxy.js";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const modes: readonly EnforcementMode[] = ["off", "policy"];
const mode = (flag("mode") ?? "policy") as EnforcementMode;
if (!modes.includes(mode)) {
  process.stderr.write(
    `--mode must be one of ${modes.join(", ")} (the model-judged modes need a judge model)\n`,
  );
  process.exit(2);
}
const story = scenario(flag("story") ?? SCENARIOS[0]?.id ?? "");
// A live clock: limits count real days.
const clock = {
  get now() {
    return Date.now();
  },
  set now(_ignored: number) {},
};
const { sandbox } = createWorldSandbox(story, { mode, clock });
sandbox.record.subscribe((entry) => {
  process.stderr.write(
    `${JSON.stringify({ seq: entry.seq, tool: entry.tool, result: entry.result, summary: entry.decision.summary })}\n`,
  );
});
const server = createMcpProxy(sandbox, { name: "harbour-finch-sandbox", version: "0.1.0" });
await server.connect(new StdioServerTransport());
