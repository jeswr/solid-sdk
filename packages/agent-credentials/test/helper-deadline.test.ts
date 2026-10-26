// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6
import { spawn } from "child_process";
import { EventEmitter } from "events";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PassThrough } from "stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { accessToken, EXIT, helperExchange } from "../src/operations.js";
import { HelperTokenProvider, runHelper } from "../src/providers/credentials.js";
import * as providers from "../src/providers.js";
import { GOOGLE, type Transport } from "../src/providers.js";
import { CredentialStore, type Grant, type Profile } from "../src/store.js";
import {
  CALL_TIMEOUT_MS,
  HELPER_DEADLINE_MS,
  HELPER_KILL_TIMEOUT_MS,
  HELPER_PERSIST_RESERVE_MS,
  LOCK_WAIT_MS,
} from "../src/timeouts.js";
import { fixtureValue } from "./fixture.js";

vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: vi.fn(),
}));
// Use the same virtual timer for lock polling as for the helper and provider deadlines.
vi.mock("timers/promises", () => ({
  setTimeout: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}));

const instant = new Date("2026-10-26T00:00:00Z");
const profile: Profile = {
  version: 1,
  name: "fixture",
  provider: "google",
  account: "owner@example.org",
  connectionId: "owner",
  purpose: "read",
  resource: "mail",
  inventory: false,
  createdAt: instant.toISOString(),
};
const request = { provider: "google" as const, connectionId: "owner", scopes: [GOOGLE.MAIL_READ] };
const answer = {
  access_token: "test-access-0123456789",
  refresh_token: "test-rotated-0123456789",
  expires_in: 3600,
  token_type: "Bearer",
};
let base: string;
let store: CredentialStore;
let originalGrant: Grant;
beforeEach(() => {
  vi.useFakeTimers();
  base = mkdtempSync(join(tmpdir(), "credentials-deadline-"));
  store = new CredentialStore(join(base, "store"));
  const clientId = "fixture.apps.googleusercontent.com";
  store.putClient({
    version: 1,
    provider: "google",
    clientId,
    importedFrom: "fixture",
    importedAt: instant.toISOString(),
  });
  store.putProfile(profile);
  originalGrant = {
    version: 1,
    profile: profile.name,
    provider: profile.provider,
    purpose: profile.purpose,
    resource: profile.resource,
    clientId,
    account: { subject: "fixture-sub", username: profile.account },
    grantedScopes: request.scopes,
    state: "active",
    refreshToken: "test-original-0123456789",
    obtainedAt: instant.toISOString(),
    updatedAt: instant.toISOString(),
  };
  store.putGrant(originalGrant);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(base, { recursive: true, force: true });
});
const deps = (transport: Transport) => ({ store, transport, now: () => new Date() });
const exchange = (transport: Transport, deadline?: number) =>
  helperExchange(deps(transport), profile.name, JSON.stringify(request), deadline);

/** Exercise the real CLI/helper/provider path with in-memory process pipes. */
function parent(transport: Transport) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), { stdin, stdout, kill: vi.fn() });
  let input = "";
  const requestText = new Promise<string>((resolve) => {
    stdin.on("data", (chunk: Buffer) => {
      input += chunk.toString("utf8");
    });
    stdin.on("end", () => resolve(input));
  });
  const stderr: string[] = [];
  vi.mocked(spawn).mockImplementationOnce(() => {
    void main(["--dir", store.dir, "token", "--profile", profile.name], {
      readStdin: () => requestText,
      stdout: (s) => {
        stdout.write(s);
      },
      stderr: (s) => {
        stderr.push(s);
      },
      transport,
    }).then((code) => child.emit("close", code, null));
    return child as unknown as ReturnType<typeof spawn>;
  });
  const provider = new HelperTokenProvider({
    version: 1,
    accounts: [
      {
        provider: "google",
        connectionId: "owner",
        credential: { type: "helper", command: "/fixture/helper", args: [] },
      },
    ],
  });
  return { pending: provider.getAccessToken(request), child, stderr };
}

it("allows an 11-second refresh through the parent and CLI, persisting its rotated token", async () => {
  const transport = vi.fn(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 11_000));
    return new Response(JSON.stringify(answer));
  });
  const { pending, child } = parent(transport);
  await vi.advanceTimersByTimeAsync(11_000);
  expect(await pending).toMatchObject({ token: answer.access_token });
  expect(transport).toHaveBeenCalledOnce();
  expect(store.grant(profile.name)?.refreshToken).toBe(answer.refresh_token);
  expect(readdirSync(join(store.dir, "locks"))).toEqual([]);
  expect(child.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  "headers",
  "body",
  "body cancellation failure",
])("times out stalled %s cleanly, releases its lock and exits before the parent kills", async (stage) => {
  let signal: AbortSignal | null | undefined;
  let finish: (response: Response) => void = () => {};
  const cancel = vi.fn(() => {
    if (stage === "body cancellation failure") throw new Error("test-secret");
  });
  let body: ReadableStream<Uint8Array> | undefined;
  const transport: Transport = async (_url, init) => {
    signal = init.signal;
    if (stage === "headers")
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    body = new ReadableStream<Uint8Array>({ cancel });
    return new Response(body);
  };
  const { pending, child, stderr } = parent(transport);
  const rejected = expect(pending).rejects.toMatchObject({ code: "unavailable" });
  await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
  await rejected;
  expect(signal?.aborted).toBe(true);
  expect(stderr.join("")).toContain("did not answer in time");
  expect(stderr.join("")).not.toContain("test-");
  expect(performance.now()).toBeLessThan(HELPER_DEADLINE_MS);
  expect(child.kill).not.toHaveBeenCalled();
  expect(store.grant(profile.name)).toEqual(originalGrant);
  expect(readdirSync(join(store.dir, "locks"))).toEqual([]);
  await expect(store.withLock(profile.name, async () => "released")).resolves.toBe("released");
  // Even a transport ignoring abort must never write a late answer to the store.
  if (stage === "headers") finish(new Response(JSON.stringify(answer)));
  else {
    expect(cancel).toHaveBeenCalledOnce();
    expect(fixtureValue(body).locked).toBe(false);
  }
  await vi.advanceTimersByTimeAsync(HELPER_KILL_TIMEOUT_MS);
  expect(store.grant(profile.name)).toEqual(originalGrant);
  expect(child.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("refuses to start a rotating request without a complete call and persistence budget", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(answer)));
  expect(
    await exchange(transport, performance.now() + CALL_TIMEOUT_MS + HELPER_PERSIST_RESERVE_MS - 1),
  ).toEqual({ exit: EXIT.unavailable, problem: "credential helper deadline exceeded" });
  expect(transport).not.toHaveBeenCalled();
  expect(readdirSync(join(store.dir, "locks"))).toEqual([]);
  expect(store.grant(profile.name)).toEqual(originalGrant);
});

it("fails with a typed deadline error before touching an expired helper request", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(answer)));
  await expect(
    accessToken(deps(transport), profile.name, undefined, performance.now()),
  ).rejects.toMatchObject({
    name: "HelperError",
    code: "unavailable",
    message: expect.stringMatching(/deadline/),
  });
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  "receipt",
  "persistence",
])("persists a rotation and releases the lock if the deadline passes at %s", async (stage) => {
  if (stage === "receipt") {
    const refresh = providers.refresh;
    vi.spyOn(providers, "refresh").mockImplementation(async (...args) => {
      const answer = await refresh(...args);
      // The complete validated provider answer has arrived, before operations can persist it.
      vi.advanceTimersByTime(HELPER_DEADLINE_MS);
      return answer;
    });
  } else {
    const write = store.putGrant.bind(store);
    vi.spyOn(store, "putGrant").mockImplementation((grant) => {
      // Simulate slow synchronous fsync after the provider has rotated its refresh token.
      vi.advanceTimersByTime(HELPER_DEADLINE_MS);
      write(grant);
    });
  }
  expect(await exchange(async () => new Response(JSON.stringify(answer)))).toEqual({
    exit: EXIT.unavailable,
    problem: "credential helper deadline exceeded",
  });
  expect(store.grant(profile.name)?.refreshToken).toBe(answer.refresh_token);
  expect(readdirSync(join(store.dir, "locks"))).toEqual([]);
});

it.each([
  true,
  false,
])("persists a received rotation when reduced scopes refuse token output (rotation: %s)", async (rotate) => {
  const result = await exchange(
    async () =>
      new Response(
        JSON.stringify({
          ...answer,
          scope: "openid",
          refresh_token: rotate ? answer.refresh_token : undefined,
        }),
      ),
  );
  expect(result.exit).toBe(EXIT.revoked);
  expect(result.stdout).toBeUndefined();
  expect(store.grant(profile.name)).toMatchObject({
    state: "needs-reconsent",
    refreshToken: rotate ? answer.refresh_token : originalGrant.refreshToken,
  });
  expect(readdirSync(join(store.dir, "locks"))).toEqual([]);
});

it("bounds a contended lock without removing its owner or calling the provider", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(answer)));
  await store.withLock(profile.name, async () => {
    const lock = join(store.dir, "locks", `${profile.name}.lock`);
    const result = exchange(transport);
    await vi.advanceTimersByTimeAsync(LOCK_WAIT_MS);
    expect(await result).toMatchObject({ exit: EXIT.unavailable });
    expect(existsSync(lock)).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  });
  expect(readdirSync(join(store.dir, "locks"))).toEqual([]);
});

it("includes stdin time in the CLI deadline", async () => {
  const transport = vi.fn(async () => new Response(JSON.stringify(answer)));
  const output: string[] = [];
  const pending = main(["--dir", store.dir, "token", "--profile", profile.name], {
    readStdin: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, HELPER_DEADLINE_MS));
      return JSON.stringify(request);
    },
    stdout: (s) => {
      output.push(s);
    },
    stderr: (s) => {
      output.push(s);
    },
    transport,
  });
  await vi.advanceTimersByTimeAsync(HELPER_DEADLINE_MS);
  expect(await pending).toBe(EXIT.unavailable);
  expect(output.join("")).toContain("deadline exceeded");
  expect(transport).not.toHaveBeenCalled();
});

it("uses the shared budget plus a small margin for a bounded parent kill", async () => {
  expect(HELPER_KILL_TIMEOUT_MS).toBeGreaterThan(HELPER_DEADLINE_MS);
  expect(HELPER_KILL_TIMEOUT_MS - HELPER_DEADLINE_MS).toBeLessThanOrEqual(5_000);
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
  const pending = runHelper("/fixture/helper", [], request);
  const rejected = expect(pending).rejects.toMatchObject({
    code: "unavailable",
    message: expect.stringMatching(/in time/),
  });
  await vi.advanceTimersByTimeAsync(HELPER_DEADLINE_MS);
  expect(child.kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(HELPER_KILL_TIMEOUT_MS - HELPER_DEADLINE_MS);
  await rejected;
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
});

it("caps release-guard contention at the same overall deadline", async () => {
  const guard = join(store.dir, "locks", `${profile.name}.lock.guard`);
  const deadline = performance.now() + 10;
  const result = store.withLock(
    profile.name,
    async () => {
      // A foreign guard cannot be removed, even during release.
      writeFileSync(guard, "", { mode: 0o600 });
      return "done";
    },
    { deadline },
  );
  await vi.advanceTimersByTimeAsync(10);
  expect(await result).toBe("done");
  expect(existsSync(guard)).toBe(true);
});
