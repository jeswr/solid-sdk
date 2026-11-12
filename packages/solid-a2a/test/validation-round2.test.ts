// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Worker } from "node:worker_threads";
import type { Quad } from "@rdfjs/types";
import { DataFactory } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/index.js";
import { checkedQuads } from "../src/validationLimits.js";
import * as transfer from "../src/validationTransfer.js";

const intent: api.Intent = { id: "urn:round2", action: "read", target: "https://a/x" };
const shape = api.buildShapeForIntent("read");
const pools: api.ValidationWorkerPool[] = [];

class ControlledWorker extends EventEmitter {
  ref = vi.fn(() => this);
  unref = vi.fn(() => this);
  terminate = vi.fn(async () => {
    this.emit("exit", 0);
    return 0;
  });
  postMessage = vi.fn((request: { id: number }) => {
    queueMicrotask(() =>
      this.emit("message", { id: request.id, report: { conforms: true, results: [] } }),
    );
  });
  constructor(readyDelay: number | false = 0) {
    super();
    if (readyDelay !== false) setTimeout(() => this.emit("message", { ready: true }), readyDelay);
  }
}
const makePool = (options: api.ValidationWorkerPoolOptions) => {
  const pool = new api.ValidationWorkerPool(options);
  pools.push(pool);
  return pool;
};
const withWorker = (worker: ControlledWorker, options: api.ValidationWorkerPoolOptions = {}) =>
  makePool({ size: 1, workerFactory: () => worker as unknown as Worker, ...options });
const validate = (workerPool: api.ValidationWorkerPool, timeoutMs = 2000) =>
  api.validateIntent(intent, shape, { workerPool, timeoutMs });

afterEach(async () => {
  // Restore real timers before shutdown, including when an assertion fails.
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe("worker pool review regressions", () => {
  it.each([
    4500, 10000,
  ])("survives %i near-term-cap shapes in a child and refuses before encoding", async (count) => {
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/validation-payload.mjs", import.meta.url)), String(count)],
      { timeout: 20_000, cwd: "/tmp" },
    );
  });

  it.each([
    false,
    true,
  ])("bounds total characters before transfer (shapes=%s), including raw duplicates", async (shapes) => {
    const { namedNode, quad, literal } = DataFactory;
    const q = quad(namedNode("urn:s"), namedNode("urn:p"), literal("x".repeat(4000)));
    const input = Array.from({ length: shapes ? 1100 : 300 }, () => q);
    expect(() => checkedQuads(input, shapes)).toThrow(/total characters/);
    const worker = new ControlledWorker();
    const pool = withWorker(worker);
    const report = await api.validateIntent(shapes ? intent : input, shapes ? input : shape, {
      workerPool: pool,
    });
    expect(report).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("total characters") }],
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])("accepts the exact aggregate limit, including literal metadata and graph names (shapes=%s)", (shapes) => {
    const { namedNode, quad } = DataFactory;
    const literal = DataFactory.literal as unknown as (
      text: string,
      options: { language: string; direction: string },
    ) => ReturnType<typeof DataFactory.literal>;
    const budget = shapes ? 4_194_304 : 1_048_576;
    const object = literal("x".repeat(3900), { language: "en", direction: "rtl" });
    const q = quad(namedNode("urn:s"), namedNode("urn:p"), object, namedNode("urn:graph"));
    const length =
      q.subject.value.length +
      q.predicate.value.length +
      object.value.length +
      object.language.length +
      object.datatype.value.length +
      3 +
      q.graph.value.length;
    const input: Quad[] = Array.from({ length: Math.floor(budget / length) }, () => q);
    const remainder = budget % length;
    // Fill the last few code units with a valid small quad of precisely that size.
    const tail = quad(
      namedNode("urn:s"),
      namedNode("urn:p"),
      namedNode(`urn:${"x".repeat(remainder - 14)}`),
    );
    input.push(tail);
    expect(checkedQuads(input, shapes)).toHaveLength(input.length);
    input[input.length - 1] = quad(
      tail.subject,
      tail.predicate,
      namedNode(`${tail.object.value}x`),
    );
    expect(() => checkedQuads(input, shapes)).toThrow(/total characters/);
  });

  it("survives almost the full allowed budgets with sixfold N-Quads escaping in a child", async () => {
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/validation-payload.mjs", import.meta.url)), "escaped"],
      { timeout: 20_000, cwd: "/tmp" },
    );
  });

  it("serves sixteen queued calls within default deadlines after a controlled ready handshake", async () => {
    vi.useFakeTimers();
    const workers: ControlledWorker[] = [];
    const pool = makePool({
      size: 2,
      workerFactory: () => {
        const worker = new ControlledWorker(500);
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const pending = Promise.all(Array.from({ length: 16 }, () => validate(pool)));
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).every((report) => report.conforms)).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it("warms once across ten 200 ms calls when startup takes 650 ms (bench4)", async () => {
    vi.useFakeTimers();
    const workers: ControlledWorker[] = [];
    const pool = makePool({
      size: 1,
      workerFactory: () => {
        const worker = new ControlledWorker(650);
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const reports: api.ValidationReport[] = [];
    for (let index = 0; index < 10; index += 1) {
      const pending = validate(pool, 200);
      await vi.advanceTimersByTimeAsync(200);
      reports.push(await pending);
    }
    expect(reports.some((report) => report.conforms)).toBe(true);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminate).not.toHaveBeenCalled();
  });

  it("keeps an unassigned worker warming past 2000 ms under its own startup timeout", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker(2500);
    const pool = withWorker(worker, { startupTimeoutMs: 3000 });
    const first = validate(pool, 100);
    await vi.advanceTimersByTimeAsync(2400);
    expect((await first).conforms).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
    const next = validate(pool, 500);
    await vi.advanceTimersByTimeAsync(100);
    expect((await next).conforms).toBe(true);
  });

  it("fails queued work on idle startup timeout without posting it", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker(false);
    const pool = withWorker(worker, { startupTimeoutMs: 25 });
    const pending = validate(pool, 500);
    await vi.advanceTimersByTimeAsync(150);
    expect(await pending).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("startup exceeded 25 ms") }],
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    null,
    { id: -1 },
    { id: 1, report: { conforms: "yes", results: [] } },
    { id: 1, report: { conforms: true, results: null } },
  ])("fails closed on invalid or unknown worker message %j", async (message) => {
    const worker = new ControlledWorker();
    worker.postMessage.mockImplementation(() => {
      worker.emit("message", message);
    });
    const report = await validate(withWorker(worker));
    expect(report).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("invalid message") }],
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("refuses queued work when a worker sends an invalid message before ready", async () => {
    const worker = new ControlledWorker(false);
    const pool = withWorker(worker);
    const pending = validate(pool);
    await vi.waitFor(() => expect(worker.listenerCount("message")).toBeGreaterThan(0));
    worker.emit("message", { id: 999 });
    expect(await pending).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("invalid message") }],
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it("fails closed on postMessage failure", async () => {
    const worker = new ControlledWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("cannot clone");
    });
    expect(await validate(withWorker(worker))).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("transfer failed") }],
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("fails closed when terminate rejects and keeps the slot reserved until exit", async () => {
    const worker = new ControlledWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("cannot clone");
    });
    worker.terminate.mockRejectedValue(new Error("termination rejected"));
    const factory = vi.fn(() => worker as unknown as Worker);
    const pool = makePool({ size: 1, workerFactory: factory });
    expect(await validate(pool)).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("termination failed") }],
    });
    expect((await validate(pool, 20)).conforms).toBe(false);
    expect(factory).toHaveBeenCalledOnce();
    worker.emit("exit", 1);
  });

  it.each([
    "before encoding",
    "during encoding",
  ])("expires %s without terminating an unused worker", async (phase) => {
    const worker = new ControlledWorker();
    const pool = withWorker(worker);
    expect((await validate(pool)).conforms).toBe(true);
    worker.postMessage.mockClear();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    if (phase === "before encoding") {
      worker.ref.mockImplementation(() => {
        now = 2001;
        return worker;
      });
    } else {
      const encode = transfer.encodeValidationQuads;
      vi.spyOn(transfer, "encodeValidationQuads").mockImplementation((quads) => {
        now = 2001;
        return encode(quads);
      });
    }
    expect(await validate(pool)).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("2000 ms wall-clock") }],
    });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("drains a full expired queue without recursive dispatch overflowing the host stack", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    const pool = withWorker(worker, { maxQueueSize: 8192 });
    const warm = validate(pool);
    await vi.advanceTimersByTimeAsync(0);
    expect((await warm).conforms).toBe(true);
    worker.postMessage.mockImplementation(() => {});
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const active = validate(pool);
    const pending = Promise.all(Array.from({ length: 8192 }, () => validate(pool)));
    await vi.advanceTimersByTimeAsync(0);
    const id = worker.postMessage.mock.calls.at(-1)?.[0].id;
    worker.ref.mockImplementation(() => {
      now = 2001;
      return worker;
    });
    expect(() =>
      worker.emit("message", { id, report: { conforms: true, results: [] } }),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect((await active).conforms).toBe(true);
    expect((await pending).every((report) => !report.conforms)).toBe(true);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("closes during lazy initialization without creating a worker", async () => {
    const factory = vi.fn(() => new ControlledWorker() as unknown as Worker);
    const pool = makePool({ size: 1, workerFactory: factory });
    const pending = validate(pool);
    await pool.close();
    expect(await pending).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("closed") }],
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it("settles a hung terminate within deadline plus 100 ms grace and reserves its capacity until exit", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    worker.postMessage.mockImplementation(() => {});
    worker.terminate.mockImplementation(() => new Promise(() => {}));
    const replacement = new ControlledWorker(false);
    const factory = vi
      .fn()
      .mockReturnValueOnce(worker as unknown as Worker)
      .mockReturnValue(replacement as unknown as Worker);
    const pool = makePool({ size: 1, workerFactory: factory });
    let result: api.ValidationReport | undefined;
    void validate(pool, 20).then((report) => {
      result = report;
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(result).toMatchObject({ conforms: false });
    const next = validate(pool, 20);
    await vi.advanceTimersByTimeAsync(20);
    expect((await next).conforms).toBe(false);
    expect(factory).toHaveBeenCalledOnce();
    const queued = validate(pool, 1000);
    await vi.advanceTimersByTimeAsync(0);
    worker.emit("exit", 1);
    replacement.emit("message", { ready: true });
    await vi.advanceTimersByTimeAsync(0);
    expect((await queued).conforms).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("bounds close when termination hangs", async () => {
    vi.useFakeTimers();
    const worker = new ControlledWorker();
    worker.terminate.mockImplementation(() => new Promise(() => {}));
    const pool = withWorker(worker);
    const pending = validate(pool);
    await vi.advanceTimersByTimeAsync(0);
    expect((await pending).conforms).toBe(true);
    let closed = false;
    void pool.close().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(closed).toBe(true);
    worker.emit("exit", 0);
  });

  it("does not expose an uncapped run method", () => {
    expect((makePool({ size: 1 }) as unknown as { run?: unknown }).run).toBeUndefined();
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    2 ** 31,
  ])("rejects invalid startup timeout %s", (startupTimeoutMs) => {
    expect(() => new api.ValidationWorkerPool({ startupTimeoutMs })).toThrow(
      /startupTimeoutMs must be an integer/,
    );
  });
});
