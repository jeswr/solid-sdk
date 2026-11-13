// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { inspect } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";

const processFake = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn: processFake.spawn }));

import { runOp } from "../src/index.js";
import { PASSWORD } from "./helpers.js";

function fakeChild() {
  const c = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  processFake.spawn.mockReturnValue(c);
  return c;
}
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("default op process runner (fake processes only)", () => {
  it("uses argv, explicit env, piped stdin, no shell, and consumes diagnostics privately", async () => {
    vi.useFakeTimers();
    const c = fakeChild();
    const promise = runOp({
      argv: ["item", "create", "-"],
      env: { OP_SERVICE_ACCOUNT_TOKEN: "fixture-service" },
      stdin: PASSWORD,
    });
    c.stdout.write('{"id":"fixture"}');
    c.stderr.write(PASSWORD);
    c.emit("close", 0);
    expect(await promise).toEqual({ stdout: '{"id":"fixture"}' });
    const call = processFake.spawn.mock.calls[0];
    expect(call?.[0]).toBe("op");
    expect(call?.[1]).toEqual(["item", "create", "-"]);
    expect(call?.[2].shell).toBe(false);
    expect(call?.[2].env.OP_SERVICE_ACCOUNT_TOKEN).toBe("fixture-service");
    expect(call?.[2].env.OP_SESSION).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    "error",
    "exit",
    "timeout",
    "overflow",
  ])("sanitises %s without raw output", async (kind) => {
    vi.useFakeTimers();
    const c = fakeChild();
    const promise = runOp({ argv: [], env: {} }).catch((e) => e);
    c.stderr.write(PASSWORD);
    if (kind === "error") c.emit("error", new Error(PASSWORD));
    else if (kind === "exit") c.emit("close", 1);
    else if (kind === "timeout") vi.advanceTimersByTime(60000);
    else c.stdout.write(Buffer.alloc(1024 * 1024 + 1));
    const e = await promise;
    expect(inspect(e, { showHidden: true })).not.toContain(PASSWORD);
    expect(e.message).toBe("Vault unavailable.");
    if (kind === "timeout" || kind === "overflow") expect(c.kill).toHaveBeenCalled();
    c.emit("close", 1);
  });
});
it("preserves UTF-8 secrets when stdout splits a multi-byte character", async () => {
  vi.useFakeTimers();
  const c = fakeChild();
  const promise = runOp({ argv: [], env: {} });
  const bytes = Buffer.from('{"value":"synthetic-☃-value"}');
  for (let i = 0; i < bytes.length; i++) c.stdout.write(bytes.subarray(i, i + 1));
  c.emit("close", 0);
  expect((await promise).stdout).toBe(bytes.toString("utf8"));
});
