/**
 * The local MCP server in-process: the official SDK client talks to `runMcpServer` over
 * in-memory newline-delimited streams (the stdio framing). Agents use the explicitly selected
 * solid-odrl module so the gate needs no Rust binary; the separate-process workflow with the
 * real SPARQ module is scripts/pilot-mcp-integration.mjs.
 */
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";
import { FdReader, MAX_MCP_LINE_BYTES, runMcpServer } from "./mcp/server.js";
import { FileStateStore } from "./store/state.js";

const NOW = "2026-10-19T08:00:00Z";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return out.trim().startsWith("{") ? (JSON.parse(out) as Record<string, unknown>) : {};
}

async function pair() {
  const root = mkdtempSync(join(tmpdir(), "awp-mcp-unit-"));
  dirs.push(root);
  const common = ["--dir", root, "--now", NOW];
  const ids = {
    alice: ["https://alice.example/#me", "https://agents.alice.example/personal#agent"],
    bob: ["https://bob.example/#me", "https://agents.bob.example/personal#agent"],
  } as const;
  const init: Record<string, Record<string, unknown>> = {};
  for (const [name, [party, actor]] of Object.entries(ids)) {
    const other = name === "alice" ? ids.bob[0] : ids.alice[0];
    init[name] = await cli([
      "init",
      "--policy-engine=solid-odrl",
      "--name",
      name,
      "--party",
      party,
      "--actor",
      actor,
      "--known-party",
      other,
      ...common,
    ]);
    writeFileSync(
      join(root, `${name}.card.json`),
      JSON.stringify(await cli(["card", "--name", name, ...common])),
    );
  }
  for (const [who, peer] of [
    ["alice", "bob"],
    ["bob", "alice"],
  ] as const)
    await cli([
      "pin",
      "--name",
      who,
      "--card",
      join(root, `${peer}.card.json`),
      `--party-kid=${String(init[peer]?.partyKid)}`,
      `--actor-kid=${String(init[peer]?.actorKid)}`,
      ...common,
    ]);
  return { root, ids, init };
}

/** Start the server in-process and connect the official client over in-memory stdio framing. */
async function start(root: string, name: string) {
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const logs: string[] = [];
  let stop!: () => void;
  const stopSignal = new Promise<void>((r) => {
    stop = r;
  });
  const done = runMcpServer({
    root,
    name,
    now: () => new Date(NOW),
    stdin: toServer,
    stdout: fromServer,
    log: (l) => logs.push(l),
    stopSignal,
  });
  // A generic newline-delimited JSON-RPC transport for the client side of the pipe.
  const client = new Client({ name: "unit", version: "0" });
  await client.connect(new StdioServerTransport(fromServer, toServer));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name: tool, arguments: args });
    // biome-ignore lint/suspicious/noExplicitAny: test-only view of structured tool results
    return { isError: Boolean(r.isError), value: r.structuredContent as Record<string, any> };
  };
  return { client, call, stop, done, logs, toServer };
}

describe("local MCP server (official SDK, in-process streams)", () => {
  it("advertises operator tools and the MCP binding; serialises concurrent calls", async () => {
    const { root, ids, init } = await pair();
    const s = await start(root, "alice");
    const tools = (await s.client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      "ack_outbound",
      "deliver_inbound",
      "get_evidence",
      "get_profile",
      "get_status",
      "list_outbound",
      "propose_meeting", // the personal role's declared operation
      "submit_approval",
    ]);
    const profile = (await s.call("get_profile")).value;
    expect(profile.agent.role).toBe("personal");
    expect(profile.operations).toEqual([
      { name: "propose_meeting", title: "Propose a synthetic meeting" },
    ]);
    expect(profile.description.bindings.map((b: { id: string }) => b.id)).toContain("mcp-tool/0.1");
    expect(profile.policyModule).toMatchObject({
      status: "ready",
      evaluator: { name: "@jeswr/solid-odrl" },
    });
    // Many concurrent calls: all succeed; exactly one conversation from the one proposal.
    const results = await Promise.all([
      s.call("propose_meeting", {
        peerActor: ids.bob[1],
        windowStart: "2026-10-20T13:00:00Z",
        windowEnd: "2026-10-20T17:00:00Z",
      }),
      ...Array.from({ length: 10 }, () => s.call("get_status")),
      s.call("list_outbound"),
    ]);
    expect(results.every((r) => !r.isError)).toBe(true);
    const status = (await s.call("get_status")).value;
    expect(status.conversations).toHaveLength(1);
    expect(status.undeliveredOutbound).toBe(1); // the describe, until acknowledged
    // While the server owns alice, configuration changes by another process are refused.
    await expect(
      cli([
        "pin",
        "--name",
        "alice",
        "--card",
        join(root, "bob.card.json"),
        `--party-kid=${String(init.bob?.partyKid)}`,
        `--actor-kid=${String(init.bob?.actorKid)}`,
        "--dir",
        root,
        "--now",
        NOW,
      ]),
    ).rejects.toThrow(/state is locked/);
    s.stop();
    expect(await s.done).toBe(0);
  });

  it("refuses an unpinned peer and oversized inbound data before the runtime", async () => {
    const { root } = await pair();
    const s = await start(root, "alice");
    const unpinned = await s.call("propose_meeting", {
      peerActor: "https://agents.mallory.example/personal#agent",
      windowStart: "2026-10-20T13:00:00Z",
      windowEnd: "2026-10-20T17:00:00Z",
    });
    expect(unpinned.isError).toBe(true);
    const r = await s.client.callTool({
      name: "deliver_inbound",
      arguments: { format: "envelope", data: "x".repeat(300 * 1024) },
    });
    expect(r.isError).toBe(true);
    const evidence = (await s.call("get_evidence", { limit: 100 })).value;
    expect(
      evidence.records.some((e: { record: { type: string } }) => e.record.type === "message"),
    ).toBe(false);
    s.stop();
    await s.done;
  });

  it("a FIFO stdin reports EOF when its last writer closes (non-blocking fd; the phase-5 hang)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awp-fifo-"));
    dirs.push(dir);
    const fifo = join(dir, "in");
    execFileSync("mkfifo", [fifo]);
    const readFd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const writeFd = openSync(fifo, "w");
    const reader = new FdReader(readFd, 5);
    const chunks: string[] = [];
    const ended = new Promise<void>((r) => reader.once("end", () => r()));
    reader.on("data", (d: Buffer) => chunks.push(d.toString()));
    await new Promise((r) => setTimeout(r, 30)); // EAGAIN while nothing is written
    writeSync(writeFd, "line-1\n");
    closeSync(writeFd); // the only writer: EOF
    await Promise.race([
      ended,
      new Promise((_, reject) => setTimeout(() => reject(new Error("no EOF within 2 s")), 2000)),
    ]);
    expect(chunks.join("")).toBe("line-1\n");
    reader.destroy();
    closeSync(readFd);
  });

  it("a stop with stdin still open and queued calls drains, refuses the overflow, and releases the lock", async () => {
    const { root } = await pair();
    const s = await start(root, "alice");
    const calls = Array.from({ length: 40 }, () =>
      s.client.callTool({ name: "get_status", arguments: {} }).then(
        (r) => (r.isError ? String((r.content as { text: string }[])[0]?.text) : "ok"),
        (e: Error) => `rejected: ${e.message}`,
      ),
    );
    await new Promise((r) => setImmediate(r));
    s.stop(); // stdin (toServer) is NOT closed
    expect(await s.done).toBe(0);
    const settled = await Promise.race([
      Promise.all(calls),
      new Promise<string[]>((r) => setTimeout(() => r(["TIMEOUT"]), 3000)),
    ]);
    expect(settled).not.toContain("TIMEOUT");
    expect(settled.every((x) => x === "ok" || /busy|shutting down/.test(x))).toBe(true);
    // 40 concurrent calls against a bound of 32: the overflow is refused, not queued forever.
    expect(settled.filter((x) => /busy|shutting down/.test(x)).length).toBeGreaterThan(0);
    expect(s.logs.at(-1)).toMatch(/lock released/);
    new FileStateStore(join(root, "alice", "state.json")).close();
  });

  it("list_outbound pages a backlog with a cursor instead of failing on size", async () => {
    const { root, ids } = await pair();
    const s = await start(root, "alice");
    for (const day of ["20", "21", "22"])
      await s.call("propose_meeting", {
        peerActor: ids.bob[1],
        windowStart: `2026-10-${day}T13:00:00Z`,
        windowEnd: `2026-10-${day}T17:00:00Z`,
      });
    const first = (await s.call("list_outbound", { limit: 2 })).value;
    expect([first.outbound.length, first.total, typeof first.nextCursor]).toEqual([2, 3, "string"]);
    const second = (await s.call("list_outbound", { cursor: first.nextCursor })).value;
    expect([second.outbound.length, second.nextCursor]).toEqual([1, undefined]);
    const ids3 = [...first.outbound, ...second.outbound].map((o: { id: string }) => o.id);
    expect(new Set(ids3).size).toBe(3);
    const stale = await s.call("list_outbound", { cursor: "urn:awp:not-pending" });
    expect(stale.isError).toBe(true);
    s.stop();
    await s.done;
  });

  it("an oversized MCP line stops the server before buffering it; the lock is released and state kept", async () => {
    const { root, ids } = await pair();
    const s = await start(root, "alice");
    await s.call("propose_meeting", {
      peerActor: ids.bob[1],
      windowStart: "2026-10-20T13:00:00Z",
      windowEnd: "2026-10-20T17:00:00Z",
    });
    s.toServer.write(Buffer.alloc(MAX_MCP_LINE_BYTES + 10, 0x61));
    expect(await s.done).toBe(0);
    expect(s.logs.some((l) => /exceeds/.test(l))).toBe(true);
    expect(s.logs.at(-1)).toMatch(/lock released/);
    // The lock is free again and the state survived: a restarted server sees the conversation.
    new FileStateStore(join(root, "alice", "state.json")).close();
    const again = await start(root, "alice");
    const status = (await again.call("get_status")).value;
    expect(status.conversations).toHaveLength(1);
    again.stop();
    await again.done;
  });
});
