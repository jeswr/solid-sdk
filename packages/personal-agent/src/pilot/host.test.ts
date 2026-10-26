/**
 * AgentHost's prepared-rendering cache is bounded on every insertion path (prepare, deliver,
 * listOutbound), and eviction never makes a durable pending message inaccessible.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, openAgent } from "./cli.js";
import { AgentHost, type Json, MAX_PREPARED_CACHE } from "./host.js";

const NOW = "2026-10-19T08:00:00Z";
const dirs: string[] = [];
const hosts: AgentHost[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.agent.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return out.trim().startsWith("{") ? (JSON.parse(out) as Record<string, unknown>) : {};
}

describe("AgentHost prepared cache", () => {
  it("stays bounded while every pending message remains listable", async () => {
    const root = mkdtempSync(join(tmpdir(), "awp-host-"));
    dirs.push(root);
    const common = ["--dir", root, "--now", NOW, "--policy-engine=solid-odrl"];
    const ids = {
      alice: ["https://alice.example/#me", "https://agents.alice.example/personal#agent"],
      bob: ["https://bob.example/#me", "https://agents.bob.example/personal#agent"],
    };
    const init: Record<string, Json> = {};
    for (const [n, [party, actor]] of Object.entries(ids)) {
      init[n] = await cli([
        "init",
        "--name",
        n,
        "--party",
        party as string,
        "--actor",
        actor as string,
        ...common,
      ]);
      writeFileSync(
        join(root, `${n}.card.json`),
        JSON.stringify(await cli(["card", "--name", n, ...common])),
      );
    }
    await cli([
      "pin",
      "--name",
      "alice",
      "--card",
      join(root, "bob.card.json"),
      `--party-kid=${String(init.bob?.partyKid)}`,
      `--actor-kid=${String(init.bob?.actorKid)}`,
      ...common,
    ]);
    const a = await openAgent(root, "alice", () => new Date(NOW));
    const h = new AgentHost(a, () => new Date(NOW));
    hosts.push(h);
    const total = MAX_PREPARED_CACHE + 20;
    for (let i = 0; i < total; i++)
      await h.call(() =>
        h.runOperation("propose_meeting", {
          peerActor: ids.bob[1],
          windowStart: "2026-10-20T13:00:00Z",
          windowEnd: "2026-10-20T17:00:00Z",
        }),
      );
    expect(h.preparedCacheSize).toBeLessThanOrEqual(MAX_PREPARED_CACHE);
    // Page through everything: evicted entries are re-prepared from the durable outbox.
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const page = await h.call(() => h.listOutbound({ ...(cursor ? { cursor } : {}), limit: 50 }));
      for (const o of page.outbound as { id: string }[]) seen.add(o.id);
      expect(h.preparedCacheSize).toBeLessThanOrEqual(MAX_PREPARED_CACHE);
      cursor = page.nextCursor as string | undefined;
      if (!cursor) break;
    }
    expect(seen.size).toBe(total);
  }, 60_000);
});
