/**
 * Owner custody as a runtime boundary, and startup lock release.
 *  - The runtime never reads owner private material (checked by making a colocated owner key
 *    unreadable: opening, status, card and receipt still work).
 *  - Separate custody is refused inside the service directory and never overwrites a key.
 *  - A startup failure AFTER the single-writer lock (and role construction) releases the lock.
 */
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main, openAgent } from "./cli.js";
import { readOwnerKey } from "./setup.js";
import { FileStateStore } from "./store/state.js";

const NOW = "2026-10-19T08:00:00Z";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    const key = join(d, "alice", "keys", "owner.private.jwk.json");
    if (existsSync(key)) chmodSync(key, 0o600);
    rmSync(d, { recursive: true, force: true });
  }
});

async function cli(args: string[]) {
  let out = "";
  await main([...args], { stdout: (s) => (out += s) });
  return out.trim().startsWith("{") ? (JSON.parse(out) as Record<string, unknown>) : {};
}

async function initAlice(extra: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "awp-custody-"));
  dirs.push(root);
  const out = await cli([
    "init",
    "--policy-engine=solid-odrl",
    "--name",
    "alice",
    "--party",
    "https://alice.example/#me",
    "--actor",
    "https://agents.alice.example/personal#agent",
    "--dir",
    root,
    "--now",
    NOW,
    ...extra,
  ]);
  return { root, out };
}

describe("owner custody and startup", () => {
  it("colocated compatibility: the runtime works with the owner key unreadable (it is never read)", async () => {
    const { root, out } = await initAlice();
    expect(String(out.ownerCustody)).toMatch(/^colocated/);
    const key = join(root, "alice", "keys", "owner.private.jwk.json");
    chmodSync(key, 0o000);
    const a = await openAgent(root, "alice", () => new Date(NOW));
    expect(a.rt.mandateStatus().loaded).toBe(true);
    a.close();
    expect(await cli(["status", "--name", "alice", "--dir", root, "--now", NOW])).toHaveProperty(
      "conversations",
    );
    expect(await cli(["card", "--name", "alice", "--dir", root])).toHaveProperty("partyKey");
    // Only an explicit owner-signing step reads it (and fails here, as expected).
    await expect(readOwnerKey(root, "alice")).rejects.toThrow();
  });

  it("separate custody: never inside the service directory, never overwriting an owner key", async () => {
    const root = mkdtempSync(join(tmpdir(), "awp-custody-"));
    dirs.push(root);
    const base = [
      "init",
      "--policy-engine=solid-odrl",
      "--name",
      "alice",
      "--party",
      "https://alice.example/#me",
      "--actor",
      "https://agents.alice.example/personal#agent",
      "--dir",
      root,
      "--now",
      NOW,
    ];
    await expect(cli([...base, "--owner-dir", root])).rejects.toThrow(
      /outside the agent's service/,
    );
    await expect(cli([...base, "--owner-dir", join(root, "alice", "keys")])).rejects.toThrow(
      /outside the agent's service/,
    );
    const owners = join(root, "..", `${root.split("/").pop()}-owners`);
    dirs.push(owners);
    const ok = await cli([...base, "--owner-dir", owners]);
    expect(String(ok.ownerCustody)).toMatch(/^separate/);
    expect(existsSync(join(root, "alice", "keys", "owner.private.jwk.json"))).toBe(false);
    const before = readFileSync(join(owners, "alice", "owner.private.jwk.json"), "utf8");
    await expect(cli([...base, "--owner-dir", owners])).rejects.toThrow(/not overwritten/);
    expect(readFileSync(join(owners, "alice", "owner.private.jwk.json"), "utf8")).toBe(before);
    expect((await readOwnerKey(root, "alice", owners)).custody).toBe("separate");
  });

  it("a startup failure after the lock (and role construction) releases the lock", async () => {
    const { root } = await initAlice();
    const trustPath = join(root, "alice", "trust.json");
    const trust = JSON.parse(readFileSync(trustPath, "utf8"));
    trust.keys = [...trust.keys, trust.keys[0]]; // valid JSON; TrustStore.load refuses it
    writeFileSync(trustPath, JSON.stringify(trust));
    await expect(openAgent(root, "alice", () => new Date(NOW))).rejects.toThrow(/pinned twice/);
    const lock = new FileStateStore(join(root, "alice", "state.json")); // throws if still locked
    lock.close();
  });
});
