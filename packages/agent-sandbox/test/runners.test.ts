// AUTHORED-BY Claude Opus 5.5
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type AgentModel,
  agentSystemPrompt,
  createSandbox,
  createWorldSandbox,
  type ModelToolResult,
  resultText,
  runAgent,
} from "../src/index.js";
import { createMcpProxy, upstreamTools } from "../src/mcp/proxy.js";
import { runCode } from "../src/runners/code.js";
import { AGENT_ID, createWorld, DIRECTORY, PURPOSE, SYSTEM, scenario } from "../src/world/index.js";

const care = scenario("injected-refund");

describe("code box", () => {
  it("only reaches the world through gated tools", async () => {
    const { sandbox, world } = createWorldSandbox(care);
    const run = await runCode(
      sandbox,
      `const r = await tools.payments_refund({ customer: "c-1003", amount: 5000, toAccount: "GB00FAKE" });
       log(r.status, typeof process, typeof require, typeof setTimeout, typeof fetch);`,
    );
    expect(run).toMatchObject({
      ok: true,
      logs: ["stopped undefined undefined undefined undefined"],
    });
    expect(world.state.refunds).toHaveLength(0);
  });

  it("stops runaway loops, call floods, bad arguments and syntax errors", async () => {
    const { sandbox } = createWorldSandbox(care);
    expect((await runCode(sandbox, "while (true) {}", { cpuMs: 50 })).error).toMatch(
      /interrupted/i,
    );
    const flood = await runCode(
      sandbox,
      "for (let i = 0; i < 5; i++) log((await tools.tickets_list()).status);",
      { maxCalls: 3 },
    );
    expect(flood.logs).toEqual(["done", "done", "done", "refused", "refused"]);
    const bad = await runCode(sandbox, "log((await tools.tickets_list([1])).status)");
    expect(bad.logs).toEqual(["refused"]);
    expect((await runCode(sandbox, "this is not javascript")).error).toMatch(/SyntaxError/);
    expect((await runCode(sandbox, "throw new TypeError('boom')")).error).toBe("TypeError: boom");
    expect((await runCode(sandbox, "throw 'plain'")).error).toBe("plain");
  });

  it("stops scripts that wait forever", async () => {
    const { sandbox } = createWorldSandbox(care);
    const run = await runCode(sandbox, "await new Promise(() => {});", { timeoutMs: 100 });
    expect(run.error).toMatch(/limit and was stopped/);
  });

  it("caps memory", async () => {
    const { sandbox } = createWorldSandbox(care);
    const run = await runCode(
      sandbox,
      "const a = []; while (true) a.push(new Array(1e5).fill(1));",
      { memoryBytes: 4 * 1024 * 1024, cpuMs: 2000 },
    );
    expect(run.error).toMatch(/out of memory/);
  });
});

describe("live-model tool loop", () => {
  const scripted = (
    turns: { text: string; calls: { id: string; tool: string; args: Record<string, unknown> }[] }[],
  ): AgentModel & { seen: ModelToolResult[][] } => {
    const seen: ModelToolResult[][] = [];
    return {
      name: "scripted",
      seen,
      start: () => {
        let i = 0;
        return {
          next: async (results) => {
            if (results) seen.push([...results]);
            const t = turns[i++];
            if (!t) throw new Error("model fell over");
            return t as never;
          },
        };
      },
    };
  };

  it("runs calls through the gate and returns refusals to the model", async () => {
    const { sandbox } = createWorldSandbox(care);
    const model = scripted([
      {
        text: "Reading the ticket.",
        calls: [{ id: "1", tool: "tickets_read", args: { ticket: "T-481" } }],
      },
      {
        text: "",
        calls: [
          {
            id: "2",
            tool: "payments_refund",
            args: { customer: "c-1003", amount: 5000, toAccount: "GB00FAKE" },
          },
        ],
      },
      { text: "Done; the large refund was stopped.", calls: [] },
    ]);
    const events = await runAgent(sandbox, model, {
      system: agentSystemPrompt("Harbour & Finch", "Finch Assist"),
      task: care.task,
    });
    expect(events.map((e) => e.kind)).toEqual(["say", "call", "call", "say", "end"]);
    expect(model.seen[1]?.[0]?.text).toMatch(/^STOPPED BY POLICY/);
  });

  it("ends on the turn limit and on model errors", async () => {
    const { sandbox } = createWorldSandbox(care);
    const loop = scripted(
      Array.from({ length: 3 }, (_, i) => ({
        text: "",
        calls: [{ id: `${i}`, tool: "tickets_list", args: {} }],
      })),
    );
    const capped = await runAgent(sandbox, loop, { system: "s", task: "t", maxTurns: 2 });
    expect(capped.at(-1)).toMatchObject({ kind: "end", reason: "turn-limit" });
    const broken = await runAgent(sandbox, scripted([]), { system: "s", task: "t" });
    expect(broken.at(-1)).toMatchObject({
      kind: "end",
      reason: "error",
      message: "model fell over",
    });
  });

  it("formats every result kind for the model", () => {
    expect(resultText({ status: "done", content: { a: 1 }, withheld: 0, entry: 0 })).toBe(
      '{"a":1}',
    );
    expect(resultText({ status: "done", content: null, withheld: 2, entry: 0 })).toMatch(
      /2 record\(s\) were withheld/,
    );
    expect(resultText({ status: "held", approval: "approval-1", message: "m", entry: 0 })).toMatch(
      /^HELD FOR APPROVAL \(approval-1\)/,
    );
    expect(resultText({ status: "failed", message: "m", entry: 0 })).toBe("FAILED: m");
  });
});

describe("MCP lockdown adapter", () => {
  async function connect(server: { connect(t: InMemoryTransport): Promise<void> }) {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([server.connect(b), client.connect(a)]);
    return client;
  }

  it("lists only allowed tools and gates every call", async () => {
    const { sandbox } = createWorldSandbox(scenario("production-database"));
    const client = await connect(createMcpProxy(sandbox));
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("db_query");
    expect(names).not.toContain("db_delete_rows");
    const ok = await client.callTool({
      name: "db_query",
      arguments: { sql: "SELECT * FROM orders" },
    });
    expect(ok.isError).toBe(false);
    const refused = await client.callTool({
      name: "db_delete_rows",
      arguments: { table: "orders", where: "1=1" },
    });
    expect(refused).toMatchObject({ isError: true, structuredContent: { status: "stopped" } });
  });

  it("wraps an upstream MCP server: described tools are gated, undescribed ones never offered", async () => {
    const upstream = new McpServer({ name: "prod-db", version: "1.0.0" });
    let deleted = 0;
    upstream.registerTool(
      "query",
      { description: "Run SQL", inputSchema: { sql: z.string() } },
      async ({ sql }) => ({
        content: [{ type: "text", text: `rows for ${sql}` }],
      }),
    );
    upstream.registerTool(
      "delete_rows",
      { description: "Delete", inputSchema: { table: z.string() } },
      async () => {
        deleted++;
        return { content: [{ type: "text", text: "deleted" }] };
      },
    );
    upstream.registerTool("fail", { description: "Always fails", inputSchema: {} }, async () => ({
      content: [{ type: "text", text: "upstream broke" }],
      isError: true,
    }));
    upstream.registerTool("mystery", { description: "Unknown", inputSchema: {} }, async () => ({
      content: [],
    }));
    const client = await connect(upstream);
    const { tools, unmapped } = await upstreamTools(client, {
      query: { system: SYSTEM.db, action: "read", kind: "read" },
      delete_rows: { system: SYSTEM.db, action: "delete", kind: "write", title: "Delete rows" },
      fail: { system: SYSTEM.db, action: "read", kind: "read" },
    });
    expect(unmapped.map((u) => u.name)).toEqual(["mystery"]);
    const world = createWorld();
    const sandbox = createSandbox({
      tools,
      rules: world.rules,
      directory: DIRECTORY,
      agent: AGENT_ID,
      purpose: PURPOSE.service,
      clock: () => Date.parse("2026-11-04T09:00:00Z"),
    });
    expect(sandbox.tools().map((t) => t.name)).toEqual(["query", "fail"]);
    expect(await sandbox.call({ tool: "query", args: { sql: "SELECT 1" } })).toMatchObject({
      status: "done",
      content: "rows for SELECT 1",
    });
    expect((await sandbox.call({ tool: "delete_rows", args: { table: "orders" } })).status).toBe(
      "stopped",
    );
    expect(deleted).toBe(0);
    expect(await sandbox.call({ tool: "fail", args: {} })).toMatchObject({
      status: "failed",
      message: expect.stringMatching(/upstream broke/),
    });
  });
});

describe("every route gets the same answer", () => {
  it("each action a story wants stopped or held stays so by direct call, code and MCP", async () => {
    const { SCENARIOS } = await import("../src/world/index.js");
    const { checkPaths } = await import("../src/index.js");
    const checks = await checkPaths(SCENARIOS.filter((s) => !s.code));
    expect(checks.length).toBeGreaterThan(5);
    const broken = checks.filter((c) => !c.holds);
    // friendly-upsell's pitch is caught only with a model reading the text (hybrid).
    expect(broken.map((c) => c.scenario)).toEqual(["friendly-upsell"]);
    expect(broken[0]?.outcomes).toEqual({ direct: "permit", code: "permit", mcp: "permit" });
  }, 60_000);
});
