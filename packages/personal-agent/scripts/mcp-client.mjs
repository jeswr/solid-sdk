#!/usr/bin/env node
// Minimal operator client for the pilot's local MCP servers (official @modelcontextprotocol/sdk).
// Each invocation SPAWNS the `awp-pilot mcp` server(s) it needs over stdio — the server is then
// the agent's single runtime owner — and shuts them down gracefully (stdin close) at the end.
// A coding agent attached through its own MCP configuration plays the same role; do not run
// this while that session (or any other runtime) owns the same agent directory.
//
//   node scripts/mcp-client.mjs --dir DIR [--now ISO] tools NAME
//   node scripts/mcp-client.mjs --dir DIR [--now ISO] call NAME TOOL ['{"json":"args"}']
//   node scripts/mcp-client.mjs --dir DIR [--now ISO] schedule INITIATOR RESPONDER \
//        --window-start ISO --window-end ISO [--duration 30]
//
// `schedule` proposes a synthetic meeting from INITIATOR to RESPONDER and shuttles the agents'
// own signed messages between the two servers over MCP until both are quiet. No LLM, no text
// generation, nothing sent to any provider. Output: one JSON document on stdout.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = fileURLToPath(new URL("../dist/pilot/cli.js", import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = argv[i];
  const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[i + 1];
  argv.splice(i, a.includes("=") ? 1 : 2);
  return v;
};
const dir = opt("dir");
const now = opt("now");
const windowStart = opt("window-start");
const windowEnd = opt("window-end");
const duration = opt("duration");
const [command, ...rest] = argv;
if (!dir || !command) {
  process.stderr.write("usage: mcp-client.mjs --dir DIR [--now ISO] tools|call|schedule …\n");
  process.exit(64);
}

async function connect(name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp", "--name", name, "--dir", dir, ...(now ? ["--now", now] : [])],
    stderr: "inherit", // server diagnostics go to our stderr; stdout stays JSON
  });
  const client = new Client({ name: "awp-operator-cli", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

async function call(client, tool, args = {}) {
  const r = await client.callTool({ name: tool, arguments: args });
  if (r.isError) throw new Error(`${tool}: ${r.content?.[0]?.text ?? "error"}`);
  return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? "{}");
}

const opened = [];
let out;
try {
  if (command === "tools") {
    const c = await connect(rest[0]);
    opened.push(c);
    out = { tools: (await c.listTools()).tools.map((t) => ({ name: t.name, title: t.title })) };
  } else if (command === "call") {
    const [name, tool, json] = rest;
    const c = await connect(name);
    opened.push(c);
    out = await call(c, tool, json ? JSON.parse(json) : {});
  } else if (command === "schedule") {
    const [initiator, responder] = rest;
    if (!windowStart || !windowEnd)
      throw new Error("schedule needs --window-start and --window-end");
    const peers = { [initiator]: await connect(initiator), [responder]: await connect(responder) };
    opened.push(...Object.values(peers));
    const actorOf = {};
    for (const [n, c] of Object.entries(peers))
      actorOf[(await call(c, "get_profile")).agent.actor] = n;
    const responderActor = Object.keys(actorOf).find((a) => actorOf[a] === responder);
    await call(peers[initiator], "propose_meeting", {
      peerActor: responderActor,
      windowStart,
      windowEnd,
      ...(duration ? { durationMinutes: Number(duration) } : {}),
    });
    const trace = [];
    for (let round = 0; round < 20; round++) {
      let moved = 0;
      for (const [from, c] of Object.entries(peers)) {
        for (const item of (await call(c, "list_outbound")).outbound) {
          const to = actorOf[item.toActor];
          if (!to) continue;
          const r = await call(peers[to], "deliver_inbound", {
            format: "envelope",
            data: JSON.stringify(item.envelope),
          });
          trace.push({ from, to, kind: item.kind, disposition: r.step?.disposition });
          await call(c, "ack_outbound", { ids: [item.id] });
          moved++;
        }
      }
      if (moved === 0) break;
    }
    const phases = {};
    for (const [n, c] of Object.entries(peers)) {
      const s = await call(c, "get_status");
      phases[n] = {
        conversations: s.conversations.map((x) => x.phase),
        holds: Object.keys(s.holds).length,
        policyModule: s.policyModule.status,
      };
    }
    out = { trace, phases };
  } else {
    throw new Error(`unknown command ${command}`);
  }
} catch (error) {
  process.stderr.write(`mcp-client: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  // Graceful: closing stdin lets each server finish, save state and release its lock.
  for (const c of opened) await c.close().catch(() => undefined);
}
if (out !== undefined) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
