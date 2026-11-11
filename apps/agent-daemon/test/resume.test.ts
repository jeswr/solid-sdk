// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { MemoryLedger } from "@jeswr/agent-audit";
import { CredentialStore, noTransport } from "@jeswr/agent-credentials";
import { issueControlStatement, verifyControlStatement } from "@jeswr/agent-mandate/control";
import type { ControlStatement } from "@jeswr/agent-model";
import { lstat, mkdtemp, rename, rm, symlink, unlink, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, expect, it, vi } from "vitest";
import { createCliHost, runCli } from "../src/cli.js";
import { createLocalState } from "../src/local.js";

vi.mock("fs/promises", async (original) => {
  const fs = await original<typeof import("fs/promises")>();
  return { ...fs, rename: vi.fn(fs.rename), unlink: vi.fn(fs.unlink) };
});

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.mocked(rename).mockReset();
  vi.mocked(unlink).mockReset();
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  vi.mocked(rename).mockImplementation(fs.rename);
  vi.mocked(unlink).mockImplementation(fs.unlink);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "awp-resume-"));
  directories.push(directory);
  const local = createLocalState(directory);
  const compose = vi.fn();
  const ownerWebId = "https://owner.example/profile#me";
  const statements: ControlStatement[] = [];
  const listVerified = vi.fn(async () => statements);
  const options = {
    daemon: compose,
    local,
    ledger: new MemoryLedger(),
    accounts: async () => [],
    credentials: {
      store: new CredentialStore({ dir: directory }),
      transport: noTransport,
      now: () => new Date(),
    },
    openLoginUrl: vi.fn(),
    launchCommand: ["/node", "run"],
    resumeAuthority: { ownerWebId, controls: { listVerified } },
  };
  return { directory, local, compose, ownerWebId, statements, listVerified, options };
}

it("awp halt and resume require a fresh real signed owner Resume before clearing the durable file", async () => {
  const f = await fixture();
  const host = createCliHost(f.options);
  const io = { print: vi.fn(), confirm: vi.fn(), signal: new AbortController().signal };
  expect(await runCli(["halt"], host, io)).toBe(0);
  expect(await f.local.halted()).toBe(true);
  expect(() => f.local.assertNotHalted()).toThrow("Local stop active");
  expect(await runCli(["resume"], host, io)).toBe(1);
  const halted = await lstat(join(f.directory, "HALT"));
  const at = new Date(Math.ceil(halted.mtimeMs) + 10);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
  const key = {
    verificationMethod: `${f.ownerWebId.split("#")[0]}#agent-key`,
    ...(await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ])),
  };
  const id = "https://pod.example/agent/control/resume.trig";
  const document = await issueControlStatement(
    {
      id,
      kind: "Resume",
      attributedTo: f.ownerWebId,
      createdAt: at.toISOString(),
      expires: new Date(+at + 60000).toISOString(),
    },
    key,
    at,
  );
  const result = await verifyControlStatement(document, {
    id,
    ownerWebId: f.ownerWebId,
    now: () => new Date(),
    webIdKeyResolver: {
      isControlledBy: async (method, owner) =>
        method === key.verificationMethod && owner === f.ownerWebId,
      resolveKey: async () => key.publicKey,
    },
  });
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error("Fixture did not verify");
  f.statements.push({ ...result.statement, type: "control-statement" });
  // Signed Resume alone leaves HALT effective until the explicit local command.
  expect(await f.local.halted()).toBe(true);
  expect(await runCli(["resume"], host, io)).toBe(0);
  expect(io.print).toHaveBeenLastCalledWith(
    "local stop cleared; signed controls and permissions still apply",
  );
  expect(await createLocalState(f.directory).halted()).toBe(false);
  expect(() => f.local.assertNotHalted()).not.toThrow();
  expect(await runCli(["resume"], host, io)).toBe(0);
  expect(io.print).toHaveBeenLastCalledWith(
    "no local stop was present; signed controls and permissions still apply",
  );
  expect(f.compose).not.toHaveBeenCalled();
});

it("rejects stale, expired, future, wrong-owner and superseded Resumes and unavailable verification", async () => {
  const f = await fixture();
  const path = join(f.directory, "HALT");
  await f.local.halt();
  const at = Date.parse("2026-11-01T12:00:00Z");
  await utimes(path, new Date(at), new Date(at));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at + 1000);
  const resume: ControlStatement = {
    type: "control-statement",
    id: "urn:resume",
    kind: "Resume",
    attributedTo: f.ownerWebId,
    createdAt: new Date(at + 1).toISOString(),
    expires: new Date(at + 2000).toISOString(),
  };
  const host = createCliHost(f.options);
  for (const statement of [
    { ...resume, createdAt: new Date(at).toISOString() },
    { ...resume, expires: new Date(at + 1000).toISOString() },
    { ...resume, createdAt: new Date(at + 1001).toISOString() },
    { ...resume, attributedTo: "urn:attacker" },
    { ...resume, kind: "Halt" as const },
  ]) {
    f.statements.splice(0, Infinity, statement);
    await expect(host.resume()).rejects.toThrow();
    expect(await f.local.halted()).toBe(true);
  }
  for (const statements of [
    [resume, { ...resume, kind: "Halt" as const }],
    [{ ...resume, kind: "Halt" as const }, resume],
  ]) {
    f.statements.splice(0, Infinity, ...statements);
    await expect(host.resume()).rejects.toThrow();
  }
  f.listVerified.mockRejectedValueOnce(new Error("unavailable"));
  await expect(host.resume()).rejects.toThrow();
  await expect(
    createCliHost({ ...f.options, resumeAuthority: undefined }).resume(),
  ).rejects.toThrow();
  expect(await f.local.halted()).toBe(true);
});

it("preserves a new halt arriving during Resume verification and refuses HALT symlinks", async () => {
  const f = await fixture();
  await f.local.halt();
  await expect(
    f.local.resume(async () => {
      await f.local.halt();
      return true;
    }),
  ).rejects.toThrow("changed");
  expect(await f.local.halted()).toBe(true);
  const path = join(f.directory, "HALT");
  await rm(path);
  await symlink(join(f.directory, "missing"), path);
  const authorize = vi.fn(async () => true);
  await expect(f.local.resume(authorize)).rejects.toThrow();
  expect(authorize).not.toHaveBeenCalled();
  expect(await f.local.halted()).toBe(true);
  expect(() => f.local.assertNotHalted()).toThrow("Local stop active");
  await rm(path);
  await writeFile(join(f.directory, "halt.lock"), "stale lock", { mode: 0o600 });
  await expect(f.local.halt()).resolves.toBeUndefined();
  expect((await lstat(path)).mode & 0o777).toBe(0o600);
  expect(await f.local.halted()).toBe(true);
  expect(() => f.local.assertNotHalted()).toThrow("Local stop active");
});

it.each(["before removal", "after unlink"])("a Halt racing Resume %s wins", async (when) => {
  const f = await fixture();
  const otherProcess = createLocalState(f.directory);
  const path = join(f.directory, "HALT");
  await f.local.halt();
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  let raced = false;
  if (when === "before removal") {
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (from === path && !raced) {
        raced = true;
        await otherProcess.halt();
      }
      return fs.rename(from, to);
    });
  } else {
    vi.mocked(unlink).mockImplementation(async (file) => {
      await fs.unlink(file);
      if (String(file).endsWith(".halt") && !raced) {
        raced = true;
        // Even while HALT is temporarily absent, dispatch stays stopped.
        expect(await otherProcess.halted()).toBe(true);
        expect(() => otherProcess.assertNotHalted()).toThrow("Local stop active");
        await otherProcess.halt();
      }
    });
  }
  await expect(f.local.resume(async () => true)).rejects.toThrow("HALT changed");
  expect(raced).toBe(true);
  expect((await lstat(path)).mode & 0o777).toBe(0o600);
  expect(await otherProcess.halted()).toBe(true);
  expect(() => otherProcess.assertNotHalted()).toThrow("Local stop active");
});

it("retains the dispatch fence if a filesystem failure prevents restoring a racing Halt", async () => {
  const f = await fixture();
  const path = join(f.directory, "HALT");
  await f.local.halt();
  const fs = await vi.importActual<typeof import("fs/promises")>("fs/promises");
  let moved = false;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (from === path) {
      await f.local.halt();
      moved = true;
    } else if (to === path && moved) {
      throw new Error("disk failed");
    }
    return fs.rename(from, to);
  });
  await expect(f.local.resume(async () => true)).rejects.toThrow("disk failed");
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await f.local.halted()).toBe(true);
  expect(() => f.local.assertNotHalted()).toThrow("Local stop active");
  vi.mocked(rename).mockImplementation(fs.rename);
  await expect(f.local.halt()).resolves.toBeUndefined();
  expect((await lstat(path)).mode & 0o777).toBe(0o600);
});
