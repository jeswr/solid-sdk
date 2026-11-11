// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildShapeForIntent, type Intent, validateIntent } from "../src/index.js";
import { workerTest } from "./validationWorkerSetup.js";

const intent: Intent = { id: "urn:timeout-test", action: "read", target: "https://a/x" };
const shape = buildShapeForIntent("read");

describe("SHACL wall-clock bound", () => {
  beforeEach(() => {
    workerTest.workers.length = 0;
    workerTest.delayMs = 0;
    workerTest.started = new SharedArrayBuffer(4);
    workerTest.crash = false;
    workerTest.exitEarly = false;
    workerTest.failConstruction = false;
  });

  afterEach(async () => {
    await Promise.all(workerTest.workers.map((worker) => worker.terminate()));
  });

  it("terminates a synchronous validator at the configured limit and keeps the event loop responsive", async () => {
    workerTest.delayMs = Number.POSITIVE_INFINITY;
    let ticks = 0;
    const heartbeat = setInterval(() => {
      ticks += 1;
    }, 10);
    try {
      const report = await validateIntent(intent, shape, { timeoutMs: 1_000 });
      expect(report).toEqual({
        conforms: false,
        results: [{ message: "Validation exceeded 1000 ms wall-clock limit" }],
      });
      expect(Atomics.load(new Int32Array(workerTest.started), 0)).toBe(1);
      expect(ticks).toBeGreaterThan(1);
      expect(workerTest.workers).toHaveLength(1);
      expect(workerTest.workers[0]?.terminate).toHaveBeenCalledOnce();
      expect(workerTest.workers[0]?.threadId).toBe(-1);
    } finally {
      clearInterval(heartbeat);
    }
  });

  it("uses a 2-second default limit", async () => {
    workerTest.delayMs = Number.POSITIVE_INFINITY;
    expect(await validateIntent(intent, shape)).toEqual({
      conforms: false,
      results: [{ message: "Validation exceeded 2000 ms wall-clock limit" }],
    });
    expect(workerTest.workers[0]?.threadId).toBe(-1);
  });

  it("honors a smaller timeout, then accepts normal validation with a larger timeout", async () => {
    expect((await validateIntent(intent, shape, { timeoutMs: 1 })).conforms).toBe(false);
    expect(await validateIntent(intent, shape, { timeoutMs: 5_000 })).toEqual({
      conforms: true,
      results: [],
    });
    expect(workerTest.workers).toHaveLength(2);
    for (const worker of workerTest.workers) {
      expect(worker.threadId).toBe(-1);
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2 ** 31,
    1.5,
  ])("fails closed on invalid timeout %s before starting a worker", async (timeoutMs) => {
    expect(await validateIntent(intent, shape, { timeoutMs })).toMatchObject({
      conforms: false,
      results: [{ message: "timeoutMs must be an integer between 1 and 2147483647" }],
    });
    expect(workerTest.workers).toHaveLength(0);
  });

  it.each([
    "crash",
    "exitEarly",
    "failConstruction",
  ] as const)("fails closed when the worker encounters %s", async (failure) => {
    workerTest[failure] = true;
    const report = await validateIntent(intent, shape);
    expect(report.conforms).toBe(false);
    expect(report.results[0]?.message).toMatch(/worker/i);
    for (const worker of workerTest.workers) expect(worker.threadId).toBe(-1);
  });

  it("retains the synchronous metered path outside Node", async () => {
    let pending: ReturnType<typeof validateIntent>;
    vi.stubGlobal("process", undefined);
    try {
      pending = validateIntent(intent, shape);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await pending).toEqual({ conforms: true, results: [] });
    expect(workerTest.workers).toHaveLength(0);
  });

  it("runs the shipped entrypoint and worker without Vitest mocks", async () => {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("./fixtures/validation-package.mjs", import.meta.url)),
    ]);
  });
});
