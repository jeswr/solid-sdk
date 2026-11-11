// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Worker } from "node:worker_threads";
import { DataFactory } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/index.js";
import { validateGraphs } from "../src/validationCore.js";
import { workerTest } from "./validationWorkerSetup.js";

const intent: api.Intent = { id: "urn:pool-test", action: "read", target: "https://a/x" };
const shape = api.buildShapeForIntent("read");
const pools: InstanceType<typeof api.ValidationWorkerPool>[] = [];
const pool = (options: ConstructorParameters<typeof api.ValidationWorkerPool>[0]) => {
  const instance = new api.ValidationWorkerPool(options);
  pools.push(instance);
  return instance;
};

beforeEach(async () => {
  await api.closeValidationPool?.();
  workerTest.workers.length = 0;
  workerTest.delayMs = 0;
  workerTest.crash = false;
  workerTest.exitEarly = false;
  workerTest.failConstruction = false;
  workerTest.messageError = false;
  workerTest.missingThreads = false;
});
afterEach(async () => {
  await api.closeValidationPool?.();
  await Promise.all(pools.splice(0).map((instance) => instance.close()));
  await Promise.all(workerTest.workers.map((worker) => worker.terminate()));
  vi.restoreAllMocks();
});

class ControlledWorker extends EventEmitter {
  threadId = 1;
  ref = vi.fn(() => this);
  unref = vi.fn(() => this);
  terminate = vi.fn(async () => {
    this.threadId = -1;
    return 0;
  });
  postMessage = vi.fn((request: { id: number }) => {
    queueMicrotask(() =>
      this.emit("message", { id: request.id, report: { conforms: true, results: [] } }),
    );
  });
  constructor() {
    super();
    setTimeout(() => this.emit("message", { ready: true }), 0);
  }
}

describe("bounded SHACL worker pool", () => {
  it("accepts 16 concurrent honest validations and reuses at most two workers", async () => {
    // Bound concurrency without turning this into a throughput benchmark on busy CI.
    const reports = await Promise.all(
      Array.from({ length: 16 }, () => api.validateIntent(intent, shape, { timeoutMs: 10_000 })),
    );
    expect(reports.filter((report) => !report.conforms)).toEqual([]);
    expect(workerTest.workers.length).toBeLessThanOrEqual(2);
    expect(workerTest.workers.length).toBeGreaterThan(0);
    const count = workerTest.workers.length;
    const reused = await Promise.all(
      Array.from({ length: 16 }, () => api.validateIntent(intent, shape, { timeoutMs: 10_000 })),
    );
    expect(reused.filter((report) => !report.conforms)).toEqual([]);
    expect(workerTest.workers).toHaveLength(count);
  });

  it("bounds the waiting queue, counts queue time and replaces a timed-out worker", async () => {
    const workerPool = pool({ size: 1, maxQueueSize: 1 });
    expect((await api.validateIntent(intent, shape, { workerPool })).conforms).toBe(true);
    workerTest.delayMs = Number.POSITIVE_INFINITY;
    // Delay is injected when a worker is constructed, so restart before the busy job.
    await workerPool.close();
    const busyPool = pool({ size: 1, maxQueueSize: 1 });
    const busy = api.validateIntent(intent, shape, { workerPool: busyPool, timeoutMs: 1_000 });
    const queued = api.validateIntent(intent, shape, { workerPool: busyPool, timeoutMs: 50 });
    const excess = await api.validateIntent(intent, shape, { workerPool: busyPool });
    expect(excess).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringMatching(/queue.*full/i) }],
    });
    expect(await queued).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("50 ms wall-clock") }],
    });
    expect(await busy).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("1000 ms wall-clock") }],
    });
    const dead = workerTest.workers.at(-1);
    await vi.waitFor(() => expect(dead?.threadId).toBe(-1));
    workerTest.delayMs = 0;
    expect((await api.validateIntent(intent, shape, { workerPool: busyPool })).conforms).toBe(true);
    expect(workerTest.workers.at(-1)).not.toBe(dead);
  });

  it("sets per-worker memory and stack limits", async () => {
    expect((await api.validateIntent(intent, shape)).conforms).toBe(true);
    for (const worker of workerTest.workers) {
      expect(worker.resourceLimits).toMatchObject({
        maxOldGenerationSizeMb: 512,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      });
    }
  });

  it("refuses excessive quad counts before reading or copying quad terms", async () => {
    const data = new Array(1_001);
    Object.defineProperty(data, 0, {
      get: () => {
        throw new Error("read oversized array");
      },
    });
    const report = await api.validateIntent(data, shape);
    expect(report).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("1000 triples") }],
    });
    expect(workerTest.workers).toHaveLength(0);
  });

  it("refuses excessive terms before N3 conversion and worker startup", async () => {
    const convert = vi.spyOn(DataFactory, "fromQuad");
    const data = [
      DataFactory.quad(
        DataFactory.namedNode(`urn:${"x".repeat(4097)}`),
        DataFactory.namedNode("urn:p"),
        DataFactory.literal("ok"),
      ),
    ];
    const report = await api.validateIntent(data, shape);
    expect(report).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("4096 characters") }],
    });
    expect(convert).not.toHaveBeenCalled();
    expect(workerTest.workers).toHaveLength(0);
  });

  it("preserves RDF 1.2 literal direction across transfer", async () => {
    const { namedNode, quad } = DataFactory;
    const literal = DataFactory.literal as unknown as (
      value: string,
      options: { language: string; direction: string },
    ) => ReturnType<typeof DataFactory.literal>;
    const data = [
      quad(
        namedNode("urn:s"),
        namedNode("urn:p"),
        literal("text", { language: "en", direction: "rtl" }),
      ),
    ];
    const sh = (local: string) => namedNode(`http://www.w3.org/ns/shacl#${local}`);
    const shapes = [
      quad(namedNode("urn:S"), sh("targetNode"), namedNode("urn:s")),
      quad(namedNode("urn:S"), sh("path"), namedNode("urn:p")),
      quad(
        namedNode("urn:S"),
        sh("hasValue"),
        literal("text", { language: "en", direction: "ltr" }),
      ),
    ];
    const expected = await validateGraphs(data, shapes);
    expect(expected.conforms).toBe(false);
    expect(await api.validateIntent(data, shapes)).toEqual(expected);
    shapes[2] = quad(
      namedNode("urn:S"),
      sh("hasValue"),
      literal("text", { language: "en", direction: "rtl" }),
    );
    expect(await api.validateIntent(data, shapes)).toEqual(await validateGraphs(data, shapes));
  });

  it("fails closed on messageerror and terminates the affected worker", async () => {
    workerTest.messageError = true;
    const report = await api.validateIntent(intent, shape);
    expect(report).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringMatching(/message.*(decode|deserial|error)/i) }],
    });
    await vi.waitFor(() => expect(workerTest.workers[0]?.threadId).toBe(-1));
  });

  it("offers explicit in-process metering and a diagnostic when worker_threads is unavailable", async () => {
    workerTest.missingThreads = true;
    const report = await api.validateIntent(intent, shape);
    expect(report).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringMatching(/worker_threads.*(workerFactory|in-process)/) }],
    });
    expect(await api.validateIntent(intent, shape, { execution: "in-process" })).toEqual({
      conforms: true,
      results: [],
    });
    expect(workerTest.workers).toHaveLength(0);
  });

  it("allows a caller-supplied worker URL and closes pending work", async () => {
    const workerPool = pool({
      size: 1,
      workerUrl: new URL("../dist/validationWorker.js", import.meta.url),
    });
    expect((await api.validateIntent(intent, shape, { workerPool })).conforms).toBe(true);
    await workerPool.close();
    expect(await api.validateIntent(intent, shape, { workerPool })).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringMatching(/closed/) }],
    });
    await vi.waitFor(() =>
      expect(workerTest.workers.every((worker) => worker.threadId === -1)).toBe(true),
    );
  });
  it("applies shape counts and all term caps on the caller before worker startup", async () => {
    const { namedNode, quad, literal } = DataFactory;
    const oversizedShapes = new Array(10_001);
    Object.defineProperty(oversizedShapes, 0, {
      get: () => {
        throw new Error("read oversized shapes");
      },
    });
    expect(await api.validateIntent(intent, oversizedShapes)).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("10000 triples") }],
    });
    for (const object of [
      literal("x".repeat(200), namedNode("http://www.w3.org/2001/XMLSchema#integer")),
      literal("x", "a".repeat(36)),
      literal("x", namedNode(`urn:${"x".repeat(4097)}`)),
    ]) {
      expect(
        await api.validateIntent([quad(namedNode("urn:s"), namedNode("urn:p"), object)], shape),
      ).toMatchObject({ conforms: false });
    }
    const labels = [
      quad(
        namedNode("urn:S"),
        namedNode("http://www.w3.org/ns/shacl#message"),
        literal("x".repeat(1025)),
      ),
    ];
    expect(await api.validateIntent(intent, labels)).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("Shape labels") }],
    });
    expect(workerTest.workers).toHaveLength(0);
  });

  it("bounds datasets even when their reported size is inaccurate, and bounds structured intent lowering", async () => {
    const q = DataFactory.quad(
      DataFactory.namedNode("urn:s"),
      DataFactory.namedNode("urn:p"),
      DataFactory.literal("x"),
    );
    let reads = 0;
    const dataset = {
      size: 0,
      *[Symbol.iterator]() {
        for (;;) {
          reads += 1;
          yield q;
        }
      },
    };
    expect(
      await api.validateIntent(dataset as Parameters<typeof api.validateIntent>[0], shape),
    ).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("1000 triples") }],
    });
    expect(reads).toBe(1001);
    expect(
      await api.validateIntent({ ...intent, parameters: new Array(1001) }, shape),
    ).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("1000 triples") }],
    });
    expect(
      await api.validateIntent({ ...intent, target: `https://a/${"x".repeat(4097)}` }, shape),
    ).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("4096 characters") }],
    });
    expect(workerTest.workers).toHaveLength(0);
  });

  it("uses a supplied worker factory without worker_threads, passing the URL and resource limits", async () => {
    workerTest.missingThreads = true;
    const worker = new ControlledWorker();
    const workerFactory = vi.fn(() => worker as unknown as Worker);
    const workerUrl = new URL("file:///bundled/validationWorker.js");
    const workerPool = pool({ size: 1, workerUrl, workerFactory });
    expect(await api.validateIntent(intent, shape, { workerPool })).toEqual({
      conforms: true,
      results: [],
    });
    expect(workerFactory).toHaveBeenCalledWith(workerUrl, {
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    expect(worker.ref).toHaveBeenCalled();
    expect(worker.unref).toHaveBeenCalledTimes(2);
    await workerPool.close();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects late successes even when the deadline timer has not fired", async () => {
    const worker = new ControlledWorker();
    const workerPool = pool({ size: 1, workerFactory: () => worker as unknown as Worker });
    expect((await api.validateIntent(intent, shape, { workerPool })).conforms).toBe(true);
    const now = performance.now();
    vi.spyOn(performance, "now").mockReturnValue(now);
    worker.postMessage.mockImplementation((request) => {
      vi.mocked(performance.now).mockReturnValue(now + 2_001);
      worker.emit("message", { id: request.id, report: { conforms: true, results: [] } });
    });
    expect(await api.validateIntent(intent, shape, { workerPool })).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("2000 ms wall-clock") }],
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    "crash",
    "exitEarly",
    "messageError",
  ] as const)("replaces a worker after %s without reusing it", async (failure) => {
    const workerPool = pool({ size: 1 });
    workerTest[failure] = true;
    expect((await api.validateIntent(intent, shape, { workerPool })).conforms).toBe(false);
    const dead = workerTest.workers[0];
    await vi.waitFor(() => expect(dead?.threadId).toBe(-1));
    workerTest[failure] = false;
    expect((await api.validateIntent(intent, shape, { workerPool })).conforms).toBe(true);
    expect(workerTest.workers).toHaveLength(2);
  });

  it("closes active and queued work and permits restarting the default pool", async () => {
    const worker = new ControlledWorker();
    worker.postMessage.mockImplementation(() => {});
    const workerPool = pool({ size: 1, workerFactory: () => worker as unknown as Worker });
    const active = api.validateIntent(intent, shape, { workerPool });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    const queued = api.validateIntent(intent, shape, { workerPool });
    await workerPool.close();
    expect((await active).conforms).toBe(false);
    expect((await queued).conforms).toBe(false);
    expect(worker.threadId).toBe(-1);
    expect((await api.validateIntent(intent, shape)).conforms).toBe(true);
    const old = [...workerTest.workers];
    await api.closeValidationPool();
    await vi.waitFor(() => expect(old.every((w) => w.threadId === -1)).toBe(true));
    expect((await api.validateIntent(intent, shape)).conforms).toBe(true);
    expect(workerTest.workers.at(-1)).not.toBe(old.at(-1));
  });

  it("fails with actionable diagnostics for a missing bundled worker", async () => {
    const workerPool = pool({ size: 1, workerUrl: new URL("file:///missing/validationWorker.js") });
    expect(await api.validateIntent(intent, shape, { workerPool })).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringMatching(/workerUrl\/workerFactory/) }],
    });
  });

  it("does not keep a Node process alive with idle workers", async () => {
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/validation-idle.mjs", import.meta.url))],
      { timeout: 10_000 },
    );
  });

  it.each([
    { size: 0 },
    { size: 1.5 },
    { size: 33 },
    { maxQueueSize: -1 },
    { maxQueueSize: Number.NaN },
  ])("rejects invalid pool configuration %j", (options) => {
    expect(() => new api.ValidationWorkerPool(options)).toThrow(/must be an integer/);
  });
  it("bounds admission during lazy initialization even with a zero-length queue", async () => {
    const workerPool = pool({ size: 1, maxQueueSize: 0 });
    const first = api.validateIntent(intent, shape, { workerPool });
    const second = api.validateIntent(intent, shape, { workerPool });
    expect(await second).toMatchObject({
      conforms: false,
      results: [{ message: "Validation worker queue is full" }],
    });
    expect((await first).conforms).toBe(true);
    expect(workerTest.workers).toHaveLength(1);
  });
  it("rejects invalid direction before transfer", async () => {
    const object = DataFactory.literal("text", "en");
    Object.defineProperty(object, "direction", { value: "x".repeat(5000) });
    const q = DataFactory.quad(
      DataFactory.namedNode("urn:s"),
      DataFactory.namedNode("urn:p"),
      object,
    );
    expect(await api.validateIntent([q], shape)).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("invalid direction") }],
    });
    expect(workerTest.workers).toHaveLength(0);
  });
});
