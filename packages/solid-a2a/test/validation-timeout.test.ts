// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildShapeForIntent,
  type Intent,
  validateIntent as publicValidateIntent,
  type ValidationOptions,
  ValidationWorkerPool,
} from "../src/index.js";
import { workerTest } from "./validationWorkerSetup.js";

const intent: Intent = { id: "urn:timeout-test", action: "read", target: "https://a/x" };
const shape = buildShapeForIntent("read");
let workerPool: ValidationWorkerPool;
const validateIntent = (input: Intent, shapes: typeof shape, options: ValidationOptions = {}) =>
  publicValidateIntent(input, shapes, { ...options, workerPool });

describe("SHACL wall-clock bound", () => {
  beforeEach(() => {
    workerPool = new ValidationWorkerPool({ size: 1 });
    workerTest.workers.length = 0;
    workerTest.delayMs = 0;
    workerTest.started = new SharedArrayBuffer(4);
    workerTest.crash = false;
    workerTest.exitEarly = false;
    workerTest.failConstruction = false;
    workerTest.messageError = false;
    workerTest.missingThreads = false;
  });

  afterEach(async () => {
    await workerPool.close();
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
      await vi.waitFor(() => expect(workerTest.workers[0]?.threadId).toBe(-1));
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
    expect(workerTest.workers[0]?.terminate).toHaveBeenCalledOnce();
    // Refusal has bounded grace; the OS may deliver exit a little later under load.
    await vi.waitFor(() => expect(workerTest.workers[0]?.threadId).toBe(-1));
  });

  it("honors a smaller timeout, then accepts normal validation with a larger timeout", async () => {
    expect((await validateIntent(intent, shape, { timeoutMs: 1 })).conforms).toBe(false);
    // Caller-side preflight can spend the entire 1 ms before a worker starts.
    const expiredWorkers = [...workerTest.workers];
    for (const worker of expiredWorkers) {
      expect(worker.threadId).toBeGreaterThan(0);
      expect(worker.terminate).not.toHaveBeenCalled();
    }
    expect(await validateIntent(intent, shape, { timeoutMs: 5_000 })).toEqual({
      conforms: true,
      results: [],
    });
    expect(workerTest.workers).toHaveLength(Math.max(expiredWorkers.length, 1));
    expect(workerTest.workers.at(-1)?.threadId).toBeGreaterThan(0);
    expect(workerTest.workers.at(-1)?.terminate).not.toHaveBeenCalled();
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
    await vi.waitFor(() => {
      for (const worker of workerTest.workers) expect(worker.threadId).toBe(-1);
    });
  });

  it("retains the synchronous metered path in a browser", async () => {
    let pending: ReturnType<typeof validateIntent>;
    vi.stubGlobal("process", undefined);
    const document = { nodeType: 9 };
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document });
    try {
      pending = validateIntent(intent, shape);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(await pending).toEqual({ conforms: true, results: [] });
    expect(workerTest.workers).toHaveLength(0);
  });

  it.each([
    undefined,
    { versions: {} },
  ])("fails closed by default in a non-browser runtime %j", async (runtime) => {
    vi.stubGlobal("process", runtime);
    try {
      expect(await validateIntent(intent, shape)).toMatchObject({
        conforms: false,
        results: [{ message: expect.stringMatching(/execution.*in-process/) }],
      });
      expect(await validateIntent(intent, shape, { execution: "in-process" })).toEqual({
        conforms: true,
        results: [],
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(workerTest.workers).toHaveLength(0);
  });

  it("fails closed for an invalid execution option", async () => {
    expect(await validateIntent(intent, shape, { execution: "invalid" as "worker" })).toMatchObject(
      {
        conforms: false,
        results: [{ message: 'execution must be "worker" or "in-process"' }],
      },
    );
    expect(workerTest.workers).toHaveLength(0);
  });

  it("fails closed on explicit worker execution outside Node when threads are unavailable", async () => {
    workerTest.missingThreads = true;
    vi.stubGlobal("process", undefined);
    try {
      expect(await validateIntent(intent, shape, { execution: "worker" })).toMatchObject({
        conforms: false,
        results: [{ message: expect.stringContaining("worker_threads") }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("runs the shipped entrypoint and worker without Vitest mocks", async () => {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("./fixtures/validation-package.mjs", import.meta.url)),
    ]);
  });
});
