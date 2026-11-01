// AUTHORED-BY Codex GPT-6.1-Sol
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HELPER_TERMINATION_GRACE_MS,
  HELPER_TIMEOUT_MS,
  PROFILE_LOCK_WAIT_MS,
  PROVIDER_CALL_TIMEOUT_MS,
} from "../../credentials/deadlines.js";
import { CredentialError, HelperTokenProvider, runHelper } from "./credentials.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

/** Controllable process lifecycle; only the helper is fake, the runner is real. */
class FakeHelper extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  kill = vi.fn((_signal: NodeJS.Signals) => true);

  output(text: string) {
    this.stdout.emit("data", Buffer.from(text));
  }

  close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.emit("close", code, signal);
  }
}

const request = { provider: "google" as const, connectionId: "fixture", scopes: [] };
const answer = JSON.stringify({ access_token: "synthetic-access-token" });

describe("credential helper deadline budget", () => {
  let helper: FakeHelper;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    helper = new FakeHelper();
    vi.mocked(spawn).mockReset();
    vi.mocked(spawn).mockReturnValue(helper as unknown as ReturnType<typeof spawn>);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const timeoutError = (result: unknown) => {
    expect(result).toBeInstanceOf(CredentialError);
    expect(result).toMatchObject({ code: "timeout", message: expect.stringMatching(/in time/) });
    expect(String(result)).not.toContain("synthetic-access-token");
  };

  it("returns a token from a fake helper completing at 18 seconds with the production default", async () => {
    const provider = new HelperTokenProvider({
      version: 1,
      accounts: [
        {
          connectionId: "fixture",
          provider: "google",
          credential: { type: "helper", command: "/fixture/helper", args: [] },
        },
      ],
    });
    const result = provider.getAccessToken(request);
    setTimeout(() => {
      helper.output(answer);
      helper.close();
    }, 18_000);
    await vi.advanceTimersByTimeAsync(18_000);
    await expect(result).resolves.toEqual({ token: "synthetic-access-token" });
    expect(helper.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows a full lock wait followed by a full provider refresh", async () => {
    const result = runHelper("/fixture/helper", [], request);
    await vi.advanceTimersByTimeAsync(PROFILE_LOCK_WAIT_MS + PROVIDER_CALL_TIMEOUT_MS);
    expect(helper.kill).not.toHaveBeenCalled();
    helper.output(answer);
    helper.close();
    await expect(result).resolves.toBe(answer);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends SIGTERM at the overridden deadline, then SIGKILL after grace even without close", async () => {
    const result = runHelper("/fixture/helper", [], request, 100).catch((error) => error);
    const settled = vi.fn();
    void result.then(settled);
    helper.output('{"access_token":"synthetic-access-token');
    await vi.advanceTimersByTimeAsync(99);
    expect(helper.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(helper.kill.mock.calls).toEqual([["SIGTERM"]]);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HELPER_TERMINATION_GRACE_MS - 1);
    expect(helper.kill.mock.calls).toEqual([["SIGTERM"]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(helper.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    timeoutError(await result);
    expect(settled).toHaveBeenCalledOnce();
    // A late successful close or error cannot expose the partial answer or settle again.
    helper.output('"}');
    helper.close();
    helper.emit("error", new Error("synthetic failure"));
    await vi.runAllTimersAsync();
    expect(settled).toHaveBeenCalledOnce();
    expect(helper.kill).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the shared default deadline before starting termination", async () => {
    const result = runHelper("/fixture/helper", [], request).catch((error) => error);
    await vi.advanceTimersByTimeAsync(HELPER_TIMEOUT_MS - 1);
    expect(helper.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(helper.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    helper.close(null, "SIGTERM");
    timeoutError(await result);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [0, null],
    [1, null],
    [3, null],
    [null, "SIGTERM"],
  ] as const)("keeps timeout typed when grace ends with exit %s / %s", async (code, signal) => {
    const result = runHelper("/fixture/helper", [], request, 100).catch((error) => error);
    helper.output(answer);
    await vi.advanceTimersByTimeAsync(100);
    // Even a complete answer during grace cannot turn the timeout into success.
    helper.output(answer);
    helper.close(code, signal);
    timeoutError(await result);
    await vi.advanceTimersByTimeAsync(HELPER_TERMINATION_GRACE_MS);
    expect(helper.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the persistence grace across process errors and excessive output after deadline", async () => {
    const result = runHelper("/fixture/helper", [], request, 100).catch((error) => error);
    await vi.advanceTimersByTimeAsync(100);
    helper.emit("error", new Error("synthetic signal race"));
    helper.output("x".repeat(20_000));
    expect(helper.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(HELPER_TERMINATION_GRACE_MS);
    timeoutError(await result);
    expect(helper.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });

  it("handles a helper closing synchronously on SIGTERM and cancels escalation", async () => {
    helper.kill.mockImplementation((signal) => {
      helper.close(null, signal);
      return true;
    });
    const result = runHelper("/fixture/helper", [], request, 100).catch((error) => error);
    await vi.advanceTimersByTimeAsync(100 + HELPER_TERMINATION_GRACE_MS);
    timeoutError(await result);
    expect(helper.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1, 3])("clears the deadline on ordinary exit %i", async (code) => {
    const result = runHelper("/fixture/helper", [], request).catch((error) => error);
    helper.output(answer);
    helper.close(code);
    if (code === 0) expect(await result).toBe(answer);
    else expect(await result).toMatchObject({ code: code === 3 ? "revoked" : "unavailable" });
    await vi.advanceTimersByTimeAsync(HELPER_TIMEOUT_MS + HELPER_TERMINATION_GRACE_MS);
    expect(helper.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline on a spawn error", async () => {
    const result = runHelper("/fixture/helper", [], request).catch((error) => error);
    helper.emit("error", new Error("synthetic spawn failure"));
    expect(await result).toMatchObject({ code: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(HELPER_TIMEOUT_MS + HELPER_TERMINATION_GRACE_MS);
    expect(helper.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });

  it("kills oversized output immediately and clears the deadline", async () => {
    const result = runHelper("/fixture/helper", [], request).catch((error) => error);
    helper.output("x".repeat(16 * 1024 + 1));
    expect(helper.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    helper.close(null, "SIGKILL");
    expect(await result).toMatchObject({ code: "invalid" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets a real fake helper finish its atomic rotated-token write on SIGTERM", async () => {
    const { spawn: realSpawn } =
      await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(spawn).mockImplementationOnce(realSpawn);
    const dir = mkdtempSync(join(tmpdir(), "awp-deadline-"));
    const grant = join(dir, "grant.json");
    const script = join(dir, "helper.mjs");
    writeFileSync(grant, JSON.stringify({ refresh_token: "synthetic-old-refresh" }));
    // Begin the temporary write, then finish/fsync/rename only when SIGTERM arrives.
    // The parent clock advances instantly; the child waits on signals, never on a sleep.
    writeFileSync(
      script,
      `import { openSync, writeSync, fsyncSync, closeSync, renameSync } from "node:fs";
const grant = process.argv[2];
process.stdin.resume();
process.stdin.on("end", () => {
  const hold = setInterval(() => {}, 1000);
  const tmp = grant + ".tmp";
  const fd = openSync(tmp, "wx", 0o600);
  writeSync(fd, '{"refresh_token":');
  process.once("SIGTERM", () => {
    clearInterval(hold);
    writeSync(fd, '"synthetic-rotated-refresh"}');
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, grant);
    process.stdout.end(JSON.stringify({ access_token: "synthetic-access-token" }));
  });
  process.stdout.write("persisting\\n");
});`,
    );
    const result = runHelper(process.execPath, [script, grant], request).catch((error) => error);
    const child = vi.mocked(spawn).mock.results[0]?.value as ReturnType<typeof spawn>;
    const kill = vi.spyOn(child, "kill");
    const closed = once(child, "close");
    try {
      const [ready] = await once(child.stdout as PassThrough, "data");
      expect(String(ready)).toBe("persisting\n");
      await vi.advanceTimersByTimeAsync(HELPER_TIMEOUT_MS);
      await closed;
      timeoutError(await result);
      expect(kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
      expect(JSON.parse(readFileSync(grant, "utf8"))).toEqual({
        refresh_token: "synthetic-rotated-refresh",
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("kills a real helper ignoring SIGTERM and never returns its late token", async () => {
    const { spawn: realSpawn } =
      await vi.importActual<typeof import("node:child_process")>("node:child_process");
    vi.mocked(spawn).mockImplementationOnce(realSpawn);
    const result = runHelper(
      process.execPath,
      [
        "-e",
        `process.stdin.resume();
process.stdin.on("end", () => {
  setInterval(() => {}, 1000);
  process.on("SIGTERM", () => process.stdout.write(${JSON.stringify(answer)}));
  process.stdout.write("ready\\n");
});`,
      ],
      request,
    ).catch((error) => error);
    const child = vi.mocked(spawn).mock.results[0]?.value as ReturnType<typeof spawn>;
    const closed = once(child, "close");
    try {
      await once(child.stdout as PassThrough, "data");
      const lateOutput = once(child.stdout as PassThrough, "data");
      await vi.advanceTimersByTimeAsync(HELPER_TIMEOUT_MS);
      await lateOutput;
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      await vi.advanceTimersByTimeAsync(HELPER_TERMINATION_GRACE_MS);
      timeoutError(await result);
      await closed;
      expect(child.signalCode).toBe("SIGKILL");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
  });
});
