// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { aggregateTaskStats, MemoryLedger } from "@jeswr/agent-audit";
import { CredentialStore, noTransport } from "@jeswr/agent-credentials";
import { digestOf } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { execFileSync } from "child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";
import { type CliHost, createCliHost, runCli, runConfiguredCli } from "../src/cli.js";
import { installLaunchd, launchdPlist } from "../src/launchd.js";
import { createLocalState, createProcessLease } from "../src/local.js";
import { scrubLog } from "../src/logging.js";
import type { AuthenticatedComposition, Daemon } from "../src/types.js";

const directories: string[] = [];
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), "awp-test-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { force: true, recursive: true });
});

it("persists cursors and local HALT with private modes and refuses a competing process", async () => {
  const dir = await temporary();
  const local = createLocalState(dir);
  expect(await local.checkpoints.get("fixture")).toBeUndefined();
  await local.checkpoints.put("fixture", "cursor");
  expect(await createLocalState(dir).checkpoints.get("fixture")).toBe("cursor");
  expect(await local.status()).toEqual({ halted: false, leasePresent: false });
  const release = await createProcessLease(dir).acquire();
  await expect(createProcessLease(dir).acquire()).rejects.toThrow();
  expect((await local.status()).leasePresent).toBe(true);
  await local.halt();
  expect(await local.halted()).toBe(true);
  await release();
  await release();
  expect((await local.status()).leasePresent).toBe(false);
  await chmod(join(dir, "cursor-fixture.json"), 0o644);
  await expect(local.checkpoints.get("fixture")).rejects.toThrow("Unsafe");
});
it("persists detached proposal results across restarts and refuses unsafe or corrupt state", async () => {
  const dir = await temporary();
  const local = createLocalState(dir);
  const key = digestOf({ account: "fixture", source: "urn:message:fixture" });
  const path = join(dir, `proposal-${key.slice(8)}.json`);
  expect(await local.proposalResults.get(key)).toBeUndefined();
  const result = { proposals: [structuredClone(exampleRecords["action-proposal"])], calls: [] };
  await local.proposalResults.put(key, result);
  expect(await createLocalState(dir).proposalResults.get(key)).toEqual(result);
  result.proposals.splice(0);
  expect((await local.proposalResults.get(key))?.proposals).toHaveLength(1);
  await expect(local.proposalResults.get("../escape")).rejects.toThrow("key");
  await expect(local.proposalResults.put("../escape", result)).rejects.toThrow("key");
  await chmod(path, 0o644);
  await expect(local.proposalResults.get(key)).rejects.toThrow("Unsafe");
  await chmod(path, 0o600);
  await writeFile(path, '{"proposals":[{}],"calls":[]}');
  await expect(local.proposalResults.get(key)).rejects.toThrow();
  await rm(path);
  await symlink(join(dir, "absent"), path);
  await expect(local.proposalResults.get(key)).rejects.toThrow();
  await expect(
    local.proposalResults.put(key, {
      proposals: [],
      calls: [],
      extra: "not allowed",
    } as unknown as Parameters<typeof local.proposalResults.put>[1]),
  ).rejects.toThrow();
});
it("refuses symlink cursor reads, bad account paths and replaced leases; HALT symlinks halt", async () => {
  const dir = await temporary();
  const local = createLocalState(dir);
  await writeFile(join(dir, "target"), '"secret-fixture"', { mode: 0o600 });
  await symlink(join(dir, "target"), join(dir, "cursor-fixture.json"));
  await expect(local.checkpoints.get("fixture")).rejects.toThrow();
  await expect(local.checkpoints.put("../escape", "cursor")).rejects.toThrow();
  await symlink(join(dir, "absent"), join(dir, "HALT"));
  expect(await local.halted()).toBe(true);
  const release = await createProcessLease(dir).acquire();
  await rm(join(dir, "daemon.lock"));
  await writeFile(join(dir, "daemon.lock"), "other", { mode: 0o600 });
  await expect(release()).rejects.toThrow("replaced");
});
it("asks before every launchd write, XML-escapes arguments, and never overwrites an existing plist", async () => {
  const home = await temporary();
  const options = {
    home,
    platform: "darwin",
    command: ["/opt/node24/bin/node", "--import", "/private/a&b.mjs", "/app/bin/awp.mjs", "run"],
  };
  expect(await installLaunchd({ ...options, confirm: async () => false })).toBe(false);
  await expect(
    readFile(join(home, "Library/LaunchAgents/org.jeswr.agent.plist")),
  ).rejects.toThrow();
  expect(await installLaunchd({ ...options, confirm: async () => true })).toBe(true);
  const path = join(home, "Library/LaunchAgents/org.jeswr.agent.plist");
  const body = await readFile(path, "utf8");
  expect(body).toContain("a&amp;b.mjs");
  // Python plistlib validates the same Apple XML plist grammar where plutil is absent.
  execFileSync("python3", [
    "-c",
    "import plistlib,sys; p=plistlib.load(open(sys.argv[1], 'rb')); assert p['KeepAlive'] and p['RunAtLoad']; assert p['ProgramArguments'][2] == '/private/a&b.mjs'",
    path,
  ]);
  if (process.platform === "darwin") execFileSync("plutil", ["-lint", path]);
  await expect(installLaunchd({ ...options, confirm: async () => true })).rejects.toThrow();
  await expect(
    installLaunchd({ ...options, platform: "linux", confirm: async () => true }),
  ).rejects.toThrow("macOS");
  expect(() => launchdPlist({ command: ["relative"], logs: "/logs" })).toThrow();
  expect(() => launchdPlist({ command: ["/node", "\u0000"], logs: "/logs" })).toThrow();
});
it("refuses a symlink at the launchd destination", async () => {
  const home = await temporary();
  await mkdir(join(home, "Library/LaunchAgents"), { recursive: true });
  await symlink("/absent", join(home, "Library/LaunchAgents/org.jeswr.agent.plist"));
  await expect(
    installLaunchd({
      home,
      platform: "darwin",
      command: ["/node", "run"],
      confirm: async () => true,
    }),
  ).rejects.toThrow();
});
it("refuses preexisting symlink directories for launchd logs", async () => {
  const home = await temporary();
  const outside = await temporary();
  await mkdir(join(home, "Library/Logs"), { recursive: true });
  await symlink(outside, join(home, "Library/Logs/jeswr-agent"));
  await expect(
    installLaunchd({
      home,
      platform: "darwin",
      command: ["/node", "run"],
      confirm: async () => true,
    }),
  ).rejects.toThrow("Unsafe");
});
it("keeps local commands independent of authentication and closes lazy compositions after failure", async () => {
  const directory = await temporary();
  const local = createLocalState(directory);
  const close = vi.fn(async () => undefined);
  const daemon: Daemon = { run: vi.fn(async () => undefined), once: vi.fn(async () => undefined) };
  const compose = vi.fn(async () => ({ daemon, close }) as unknown as AuthenticatedComposition);
  const ledger = new MemoryLedger();
  const record = {
    type: "model-call",
    id: "urn:call:1",
    owner: "https://owner.example/#me",
    agent: "https://agent.example/#me",
    proposal: "urn:proposal:fixture",
    taskId: "fixture-task",
    tokens: 4,
  } as const;
  ledger.append(record, "2026-11-01T12:00:00.000Z");
  const h = createCliHost({
    daemon: compose,
    local,
    ledger,
    launchCommand: ["/node", "run"],
    accounts: async () => [],
    openLoginUrl: vi.fn(),
    credentials: {
      store: new CredentialStore({ dir: directory }),
      transport: noTransport,
      now: () => new Date(),
    },
  });
  await h.halt();
  await h.status();
  await h.accounts();
  expect((await h.stats("fixture-task")).tasks).toMatchObject([
    { taskId: "fixture-task", modelCalls: 1, tokens: 4 },
  ]);
  expect((await h.stats("other-task")).tasks).toEqual([]);
  expect(await h.stats()).toEqual(aggregateTaskStats(ledger.entries()));
  expect(compose).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  await h.once(signal);
  expect(daemon.once).toHaveBeenCalledWith(signal);
  expect(close).toHaveBeenCalledOnce();
  vi.mocked(daemon.run).mockRejectedValueOnce(new Error("fixture"));
  await expect(h.run(new AbortController().signal)).rejects.toThrow("fixture");
  expect(close).toHaveBeenCalledTimes(2);
});
function host(): CliHost {
  return {
    run: vi.fn(async () => undefined),
    once: vi.fn(async () => undefined),
    halt: vi.fn(async () => undefined),
    status: vi.fn(async () => ({ halted: true })),
    accounts: vi.fn(async () => [{ id: "fixture", binding: "direct", enabled: false }]),
    login: vi.fn(async () => undefined),
    stats: vi.fn(async () => aggregateTaskStats([])),
    audit: vi.fn(async (_args, print) => {
      print("PASS https://pod.example/profile#me");
      return 0;
    }),
    install: vi.fn(async (confirm) => confirm("Install?")),
  };
}
it.each([
  ["run"],
  ["once"],
  ["halt"],
  ["status"],
  ["accounts"],
  ["login", "fixture"],
  ["stats"],
  ["stats", "--task", "fixture-task"],
  ["audit", "https://pod.example/agent/proposals/1"],
  ["install-launchd"],
])("dispatches awp %j", async (...args) => {
  const h = host();
  const lines: string[] = [];
  const signal = new AbortController().signal;
  expect(
    await runCli(args, h, {
      signal,
      print: (s) => lines.push(s),
      confirm: async () => false,
    }),
  ).toBe(0);
  if (args[0] === "run") expect(h.run).toHaveBeenCalledWith(signal);
  if (args[0] === "once") expect(h.once).toHaveBeenCalledWith(signal);
  expect(JSON.stringify(lines)).not.toContain("https://pod.example");
});
it.each([
  [],
  ["unknown"],
  ["login"],
  ["login", "../escape"],
  ["stats", "bad"],
  ["once", "extra"],
])("refuses malformed CLI input %j", async (...args) => {
  const h = host();
  expect(
    await runCli(args, h, {
      signal: new AbortController().signal,
      print: vi.fn(),
      stderr: vi.fn(),
      confirm: vi.fn(),
    }),
  ).toBe(2);
  expect(h.run).not.toHaveBeenCalled();
  expect(h.once).not.toHaveBeenCalled();
  expect(h.login).not.toHaveBeenCalled();
});
it("redacts paths, WebIDs and addresses, discards exception text, and refuses an unconfigured runtime", async () => {
  expect(
    scrubLog("/Users/example/secret\nhttps://pod.example/profile#me owner@example.org"),
  ).not.toMatch(/Users|pod.example|owner@/);
  const lines: string[] = [];
  const io = {
    signal: new AbortController().signal,
    print: (s: string) => lines.push(s),
    confirm: vi.fn(),
  };
  const h = host();
  vi.mocked(h.once).mockRejectedValueOnce(
    new Error("secret /Users/private https://owner.example/#me"),
  );
  expect(await runCli(["once"], h, io)).toBe(1);
  expect(lines.join()).not.toContain("secret");
  expect(await runConfiguredCli(["run"], io)).toBe(1);
  expect(await runConfiguredCli(["--help"], io)).toBe(0);
});
