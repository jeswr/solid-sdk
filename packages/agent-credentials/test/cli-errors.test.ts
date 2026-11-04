// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { spawn } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CliIo } from "../src/cli.js";
import { main } from "../src/cli.js";
import * as operations from "../src/operations.js";
import { GOOGLE } from "../src/providers.js";
import type { Grant, Profile } from "../src/store.js";
import { CredentialStore } from "../src/store.js";

vi.mock("../src/operations.js", async (original) => {
  const actual = await original<typeof import("../src/operations.js")>();
  return {
    ...actual,
    login: vi.fn(actual.login),
    helperExchange: vi.fn(actual.helperExchange),
    calendars: vi.fn(actual.calendars),
  };
});
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: vi.fn(),
}));
vi.mock("fs", async (original) => {
  const actual = await original<typeof import("fs")>();
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
    unlinkSync: vi.fn(actual.unlinkSync),
    closeSync: vi.fn(actual.closeSync),
  };
});
let base: string;
let dir: string;
let store: CredentialStore;
const now = new Date("2026-10-26T00:00:00Z");
const p: Profile = {
  version: 1,
  name: "fixture",
  provider: "google",
  connectionId: "owner",
  account: "owner@example.org",
  purpose: "read",
  resource: "calendar",
  inventory: true,
  createdAt: now.toISOString(),
};
const client = {
  version: 1 as const,
  provider: "google" as const,
  clientId: "fixture.apps.googleusercontent.com",
  importedFrom: "fixture",
  importedAt: now.toISOString(),
};
function makeGrant(): Grant {
  return {
    version: 1,
    profile: p.name,
    provider: p.provider,
    purpose: p.purpose,
    resource: p.resource,
    clientId: client.clientId,
    account: { subject: "fixture-sub", username: p.account },
    grantedScopes: [GOOGLE.CALENDAR_READ, GOOGLE.CALENDARLIST],
    state: "active",
    refreshToken: "test-refresh-0123456789",
    access: { token: "test-token-0123456789", expiresAt: "2099-01-01T00:00:00Z" },
    obtainedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
function io(over: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      now: () => now,
      env: {},
      ...over,
    },
  };
}
const run = async (args: string[], over: Partial<CliIo> = {}) => {
  const x = io(over);
  return { ...x, code: await main(["--dir", dir, ...args], x.io) };
};
beforeEach(() => {
  base = fs.mkdtempSync(join(tmpdir(), "credentials-cli-"));
  dir = join(base, "store");
  store = new CredentialStore(dir);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(base, { recursive: true, force: true });
});
it("rejects missing options, unknown commands and malformed profiles without leaking values", async () => {
  expect(await main(["status"], io().io)).toBe(1);
  expect(await main([], io().io)).toBe(1);
  expect(await main(["--help"], io().io)).toBe(0);
  expect((await run(["unknown"])).code).toBe(1);
  for (const args of [
    ["client", "google"],
    ["client", "microsoft"],
    ["client", "microsoft", "--client-id", "invalid"],
    ["client", "unknown"],
    ["profile", "add"],
    ["profile", "add", "--name", "invalid_"],
    ["profile", "unknown", "--name", "fixture"],
    ["profile", "remove", "--name", "absent"],
    ["profile", "add", "--name", "fixture"],
    ["provider-config"],
    ["login", "--profile", "fixture", "--timeout-seconds", "9"],
    ["login", "--profile", "fixture", "--timeout-seconds", "901"],
    ["login", "--profile", "fixture", "--timeout-seconds", "nan"],
  ])
    expect((await run(args)).code, args.join(" ")).toBe(1);
  const add = ["profile", "add", "--name", "fixture", "--provider", "google"];
  for (const extra of [
    [],
    ["--connection", "bad_"],
    ["--connection", "owner"],
    ["--connection", "owner", "--account", "bad"],
    ["--connection", "owner", "--account", `a@${"b".repeat(250)}.example`],
    ["--connection", "owner", "--account", p.account, "--account-type", "personal"],
    ["--connection", "owner", "--account", p.account, "--tenant", "organizations"],
    [
      "--connection",
      "owner",
      "--account",
      p.account,
      "--tenant-id",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ],
    [
      "--connection",
      "owner",
      "--account",
      p.account,
      "--object-id",
      "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    ],
  ])
    expect((await run([...add, ...extra])).code).toBe(1);
  const ms = [
    "profile",
    "add",
    "--name",
    "ms",
    "--provider",
    "microsoft",
    "--connection",
    "ms",
    "--account",
    p.account,
  ];
  expect((await run(ms)).code).toBe(1);
  expect((await run([...ms, "--account-type", "work-or-school", "--tenant", "bad"])).code).toBe(1);
  for (const extra of [
    [],
    ["--tenant-id", "bad"],
    ["--tenant-id", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
    ["--tenant-id", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "--object-id", "bad"],
    [
      "--tenant-id",
      "9188040d-6c67-4c5b-b112-36a304b66dad",
      "--object-id",
      "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    ],
  ])
    expect((await run([...ms, "--account-type", "work-or-school", ...extra])).code).toBe(1);
  expect(
    (
      await run([
        ...ms,
        "--account-type",
        "work-or-school",
        "--tenant-id",
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        "--object-id",
        "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      ])
    ).code,
  ).toBe(0);
  expect(store.profile("ms")?.microsoft?.expectedIdentity).toEqual({
    tenantId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    objectId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  });
  expect(
    (
      await run([
        ...add,
        "--connection",
        "owner",
        "--account",
        p.account,
        "--purpose",
        "read",
        "--resource",
        "mail",
      ])
    ).code,
  ).toBe(0);
  expect((await run(["profile", "remove", "--name", "fixture"])).code).toBe(0);
  expect((await run(["status"])).out.join("")).toContain("Profile ms");
});
it("imports only explicit desktop registration files and does not leak filesystem exceptions", async () => {
  const file = join(base, "client.json");
  expect((await run(["client", "google", "--client-file", "relative"])).err.join("")).toContain(
    "absolute",
  );
  expect((await run(["client", "google", "--client-file", base])).code).toBe(1);
  for (const value of [
    "x".repeat(65537),
    "invalid",
    "{}",
    JSON.stringify({ installed: { token_uri: "https://evil.example/token" } }),
    JSON.stringify({ installed: {} }),
  ]) {
    fs.writeFileSync(file, value, { mode: 0o600 });
    expect((await run(["client", "google", "--client-file", file])).code).toBe(1);
  }
  fs.writeFileSync(file, JSON.stringify({ installed: { client_id: client.clientId } }), {
    mode: 0o600,
  });
  expect((await run(["client", "google", "--client-file", file])).code).toBe(0);
  expect((await run(["client", "google", "--client-file", file])).code).toBe(0);
  fs.writeFileSync(
    file,
    JSON.stringify({ installed: { client_id: "other.apps.googleusercontent.com" } }),
  );
  store.putProfile(p);
  fs.writeFileSync(join(dir, "grants/fixture.json"), "invalid", { mode: 0o600 });
  expect((await run(["client", "google", "--client-file", file])).code).toBe(0);
  expect(
    (await run(["client", "google", "--client-file", join(base, "absent")])).err.join(""),
  ).toContain("file system error");
  const x = io({
    readStdin: async () => {
      throw new Error("test-secret-error");
    },
  });
  expect(await main(["--dir", dir, "token", "--profile", "fixture"], x.io)).toBe(1);
  expect(x.err.join("")).toContain("unexpected failure");
  expect(x.err.join("")).not.toContain("test-secret");
  const missing = io({ env: { AWP_CREDENTIALS_DIR: dir } });
  expect(await main(["status"], missing.io)).toBe(0);
  expect(await main(["--dir", dir, "status"], { stdout: () => {}, stderr: () => {} })).toBe(0);
});
it("protects config output and cleans failed atomic writes", async () => {
  const out = join(base, "config.json");
  expect((await run(["provider-config", "--out", "relative"])).code).toBe(1);
  expect((await run(["provider-config", "--out", base])).code).toBe(1);
  expect((await run(["provider-config", "--out", out])).code).toBe(0);
  expect((await run(["provider-config", "--out", out])).code).toBe(1);
  expect((await run(["provider-config", "--out", out, "--force"])).code).toBe(0);
  vi.mocked(fs.renameSync).mockImplementationOnce(() => {
    throw new Error("test-secret");
  });
  expect((await run(["provider-config", "--out", out, "--force"])).code).toBe(1);
  expect(fs.readdirSync(base).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  vi.mocked(fs.renameSync).mockImplementationOnce(() => {
    throw new Error("test-secret");
  });
  vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
    throw new Error("test-io");
  });
  expect((await run(["provider-config", "--out", out, "--force"])).code).toBe(1);
});
it("uses injected or platform browser launchers and safe summaries for login", async () => {
  store.putProfile(p);
  store.putClient(client);
  const result: operations.LoginResult = {
    profile: p.name,
    provider: p.provider,
    account: { username: p.account, subjectPinned: true },
    grantedScopes: [GOOGLE.CALENDAR_READ],
    extraScopes: ["fixture-extra"],
    replacedExisting: true,
  };
  vi.mocked(operations.login).mockImplementation(async (_deps, _name, opts) => {
    await opts.onUrl("https://accounts.google.com/?redirect_uri=http://127.0.0.1");
    return result;
  });
  const platform = fixtureValue(Object.getOwnPropertyDescriptor(process, "platform"));
  try {
    for (const [system, command] of [
      ["darwin", "open"],
      ["win32", "explorer"],
      ["linux", "xdg-open"],
    ]) {
      Object.defineProperty(process, "platform", { value: system, configurable: true });
      const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
      vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
      const r = await run(["login", "--profile", p.name, "--open", "--timeout-seconds", "10"]);
      expect(r.code).toBe(0);
      expect(r.out.join("")).toContain("fixture-extra");
      expect(spawn).toHaveBeenLastCalledWith(
        command,
        [expect.stringContaining("redirect_uri")],
        expect.objectContaining({ shell: false }),
      );
      child.emit("error", new Error("no browser"));
    }
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
  const r = await run(["login", "--profile", p.name, "--open"], {
    openBrowser: () => {
      throw new Error("test-secret");
    },
  });
  expect(r.out.join("")).toContain("Could not open");
  vi.mocked(operations.calendars).mockResolvedValueOnce([
    { id: "fixture", name: "Fixture", accessRole: "read", primary: false },
  ]);
  expect((await run(["calendars", "--profile", p.name])).out.join("")).toContain("  fixture");
  expect((await run(["logout", "--profile", p.name])).out.join("")).toContain("No local grant");
});
it("bounds process stdin, handles errors and refuses a missing request", async () => {
  store.putProfile(p);
  store.putClient(client);
  store.putGrant(makeGrant());
  const stream = new PassThrough();
  vi.spyOn(process, "stdin", "get").mockReturnValue(stream as unknown as typeof process.stdin);
  const x = io();
  const complete = main(["--dir", dir, "token", "--profile", p.name], x.io);
  stream.end(
    Buffer.from(
      JSON.stringify({ provider: "google", connectionId: "owner", scopes: [GOOGLE.CALENDAR_READ] }),
    ),
  );
  expect(await complete).toBe(0);
  expect(x.out.join("")).toContain("access_token");
  for (const kind of ["oversized", "error", "timeout"]) {
    const input = new PassThrough();
    vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin);
    if (kind === "timeout") vi.useFakeTimers();
    const output = io();
    const pending = main(["--dir", dir, "token", "--profile", p.name], output.io);
    if (kind === "oversized") input.write(Buffer.alloc(8193));
    else if (kind === "error") input.emit("error", new Error("test-secret"));
    else await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toBe(1);
    expect(output.err.join("")).not.toContain("test-secret");
    vi.useRealTimers();
  }
});
it("enforces grant removal, config path bounds and safe fallback responses", async () => {
  expect((await run(["status"])).out.join("")).toContain("No profiles");
  const output = io();
  const { now: _clock, ...withoutClock } = output.io;
  expect(
    await main(
      ["--dir", dir, "client", "microsoft", "--client-id", "00000000-1111-4222-8333-444444444444"],
      withoutClock,
    ),
  ).toBe(0);
  store.putProfile(p);
  store.putGrant(makeGrant());
  expect((await run(["profile", "remove", "--name", p.name])).err.join("")).toContain(
    "run logout first",
  );
  vi.mocked(operations.login).mockResolvedValueOnce({
    profile: p.name,
    provider: p.provider,
    account: { username: p.account, subjectPinned: true },
    grantedScopes: [],
    extraScopes: [],
    replacedExisting: false,
  });
  expect((await run(["login", "--profile", p.name])).code).toBe(0);
  vi.mocked(operations.helperExchange).mockResolvedValueOnce({ exit: 1 });
  expect(
    (await run(["token", "--profile", p.name], { readStdin: async () => "{}" })).err.join(""),
  ).toContain("failed");
  const long = join(base, "x".repeat(100), "y".repeat(100));
  fs.mkdirSync(join(base, "x".repeat(100)));
  new CredentialStore(long).putProfile(p);
  const x = io();
  expect(
    await main(["--dir", long, "provider-config", "--out", join(base, "config.json")], x.io),
  ).toBe(1);
  expect(x.err.join("")).toContain("longer");
});
it("supports manual browser navigation and JSON calendar output", async () => {
  vi.mocked(spawn).mockClear();
  store.putProfile(p);
  vi.mocked(operations.login).mockImplementationOnce(async (_deps, _name, opts) => {
    await opts.onUrl("https://accounts.google.com/?redirect_uri=http://127.0.0.1");
    return {
      profile: p.name,
      provider: p.provider,
      account: { username: p.account, subjectPinned: true },
      grantedScopes: [],
      extraScopes: [],
      replacedExisting: false,
    };
  });
  expect((await run(["login", "--profile", p.name])).out.join("")).toContain("Open this address");
  expect(spawn).not.toHaveBeenCalled();
  vi.mocked(operations.calendars).mockResolvedValueOnce([]);
  expect((await run(["calendars", "--profile", p.name, "--json"])).out.join("")).toBe("[]\n");
});
it("runs the executable helper only as its main entry and keeps import inert otherwise", async () => {
  const { fileURLToPath } = await import("url");
  const path = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const argv = process.argv;
  const exit = process.exitCode;
  const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  try {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.resetModules();
    process.argv = [process.execPath, path, "help"];
    await import("../src/cli.js");
    await Promise.resolve();
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("credential helper"));
    expect(process.exitCode).toBe(0);
    vi.resetModules();
    process.argv = [process.execPath, path, "--dir", dir, "token", "--profile", "fixture"];
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    await import("../src/cli.js");
    await Promise.resolve();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("not in a terminal"));
    expect(process.exitCode).toBe(2);
    vi.resetModules();
    process.argv = [process.execPath, path, "help"];
    stdout.mockImplementationOnce(() => {
      throw new Error("closed stdout");
    });
    await import("../src/cli.js");
    await Promise.resolve();
    expect(process.exitCode).toBe(1);
    for (const args of [[process.execPath], [process.execPath, join(base, "absent")]]) {
      vi.resetModules();
      process.argv = args;
      expect((await import("../src/cli.js")).main).toBeTypeOf("function");
    }
  } finally {
    process.argv = argv;
    process.exitCode = exit;
    if (tty) Object.defineProperty(process.stdout, "isTTY", tty);
    else Reflect.deleteProperty(process.stdout, "isTTY");
  }
});
it("does not crash the caller when helper pipes emit stream errors", async () => {
  const { runHelper } = await import("../src/providers/credentials.js");
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, kill: vi.fn() });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  const pending = runHelper("/fixture/helper", [], {});
  stdin.emit("error", Object.assign(new Error("closed pipe"), { code: "EPIPE" }));
  stdout.emit("error", new Error("read interrupted"));
  stdout.write("fixture-output");
  child.emit("close", 0, null);
  expect(await pending).toBe("fixture-output");
  expect(child.kill).not.toHaveBeenCalled();
});

import { fixtureValue } from "./fixture.js";

it("refuses generating duplicate helper mappings before writing or replacing configuration", async () => {
  store.putProfile(p);
  const out = join(base, "providers.json");
  expect((await run(["provider-config", "--out", out])).code).toBe(0);
  const original = fs.readFileSync(out, "utf8");
  store.putProfile({ ...p, name: "duplicate" });
  const result = await run(["provider-config", "--out", out, "--force"]);
  expect(result.code).toBe(1);
  expect(result.err.join("")).toContain("duplicate");
  expect(fs.readFileSync(out, "utf8")).toBe(original);
  const absent = join(base, "absent.json");
  expect((await run(["provider-config", "--out", absent])).code).toBe(1);
  expect(fs.existsSync(absent)).toBe(false);
});
