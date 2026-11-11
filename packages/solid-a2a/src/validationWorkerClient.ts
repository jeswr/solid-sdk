// AUTHORED-BY Codex GPT-6.1-Sol
import type { Worker, WorkerOptions } from "node:worker_threads";
import type { Quad } from "@rdfjs/types";
import type { ValidationReport } from "./types.js";
import { encodeValidationQuads } from "./validationTransfer.js";

export interface ValidationWorkerRequest {
  id: number;
  data: string;
  shapes: string;
}

/** The factory must return a fresh Node-compatible Worker speaking the shipped protocol. */
export type ValidationWorkerFactory = (url: URL, options: WorkerOptions) => Worker;

export interface ValidationWorkerPoolOptions {
  /** Concurrent workers, 1–32. Defaults to min(2, availableParallelism()). */
  readonly size?: number;
  /** Waiting calls beyond occupied workers, 0–65536 (default 64). */
  readonly maxQueueSize?: number;
  /** Copy the shipped validationWorker.js here when bundling the main entry. */
  readonly workerUrl?: URL;
  readonly workerFactory?: ValidationWorkerFactory;
}

type Job = {
  id: number;
  data: readonly Quad[];
  shapes: readonly Quad[];
  deadline: number;
  timeoutMs: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (report: ValidationReport) => void;
  reject: (error: Error) => void;
};
type Slot = {
  worker: Worker;
  ready: boolean;
  dead: boolean;
  job?: Job;
  startup: ReturnType<typeof setTimeout>;
};
const timeoutError = (ms: number) => new Error(`Validation exceeded ${ms} ms wall-clock limit`);

/** Lazily pre-warmed, bounded workers. A busy or failed worker is terminated before refusal settles. */
export class ValidationWorkerPool {
  private readonly options: ValidationWorkerPoolOptions;
  private readonly queue: Job[] = [];
  private readonly slots = new Set<Slot>();
  private readonly retiring = new Set<Promise<void>>();
  private initialization?: Promise<void>;
  private factory?: ValidationWorkerFactory;
  private size = 2;
  private entering = 0;
  private nextId = 0;
  private closed = false;

  constructor(options: ValidationWorkerPoolOptions = {}) {
    for (const [name, value, min, max] of [
      ["size", options.size, 1, 32],
      ["maxQueueSize", options.maxQueueSize, 0, 65_536],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
        throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
      }
    }
    this.options = { ...options };
    this.size = options.size ?? 2;
  }

  private initialize(): Promise<void> {
    this.initialization ??= (async () => {
      this.factory = this.options.workerFactory;
      if (!this.factory) {
        try {
          const { Worker } = await import("node:worker_threads");
          if (typeof Worker !== "function") throw new Error("Worker unavailable");
          this.factory = (url, options) => new Worker(url, options);
        } catch {
          throw new Error(
            'SHACL validation requires node:worker_threads; configure workerFactory or explicitly choose execution: "in-process" (weaker, no wall-clock bound)',
          );
        }
      }
      this.size = this.options.size ?? 1;
      if (this.options.size === undefined) {
        try {
          this.size = Math.min(2, (await import("node:os")).availableParallelism());
        } catch {
          // A custom factory can work in a Node-compatible runtime without node:os.
        }
      }
    })();
    return this.initialization;
  }

  /** @internal Input is already capped by intentQuads/shapeQuads on the calling thread. */
  async run(
    data: readonly Quad[],
    shapes: readonly Quad[],
    deadline: number,
    timeoutMs: number,
  ): Promise<ValidationReport> {
    if (this.closed) throw new Error("Validation worker pool is closed");
    const reserved =
      [...this.slots].filter((slot) => slot.job !== undefined).length + this.retiring.size;
    // Admission includes callers awaiting lazy module loading, before they reach queue.
    if (
      this.entering + this.queue.length + reserved >=
      this.size + (this.options.maxQueueSize ?? 64)
    ) {
      throw new Error("Validation worker queue is full");
    }
    this.entering += 1;
    try {
      await this.initialize();
    } finally {
      this.entering -= 1;
    }
    if (this.closed) throw new Error("Validation worker pool is closed");
    if (performance.now() >= deadline) throw timeoutError(timeoutMs);
    const occupied = [...this.slots].filter((slot) => slot.job !== undefined).length;
    if (
      occupied + this.retiring.size >= this.size &&
      this.queue.length >= (this.options.maxQueueSize ?? 64)
    ) {
      throw new Error("Validation worker queue is full");
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.nextId,
        data,
        shapes,
        deadline,
        timeoutMs,
        resolve,
        reject,
        timer: setTimeout(() => this.expire(job), Math.max(0, deadline - performance.now())),
      };
      this.queue.push(job);
      this.pump();
    });
  }

  private pump(): void {
    if (this.closed || this.queue.length === 0) return;
    // Warm all slots together only on demand. There is never more than size workers,
    // including workers whose termination has not yet completed.
    while (this.slots.size + this.retiring.size < this.size) {
      try {
        this.startSlot();
      } catch (error) {
        for (const job of this.queue.splice(0)) {
          clearTimeout(job.timer);
          job.reject(
            new Error(
              `Validation worker startup failed: ${String(error)}; configure workerUrl/workerFactory when bundling`,
            ),
          );
        }
        return;
      }
    }
    for (const slot of this.slots) {
      if (slot.dead || slot.job) continue;
      const job = this.queue.shift();
      if (!job) break;
      slot.job = job;
      slot.worker.ref();
      if (slot.ready) this.dispatch(slot);
    }
  }

  private startSlot(): void {
    const worker = (this.factory as ValidationWorkerFactory)(
      this.options.workerUrl ?? new URL("./validationWorker.js", import.meta.url),
      {
        resourceLimits: {
          maxOldGenerationSizeMb: 64,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      },
    );
    const slot: Slot = {
      worker,
      ready: false,
      dead: false,
      startup: setTimeout(() => {
        // Assigned jobs have their own deadline, including a caller's longer timeout.
        if (!slot.job)
          void this.retire(
            slot,
            new Error("Validation worker startup exceeded 2000 ms; check workerUrl/workerFactory"),
          );
      }, 2_000),
    };
    slot.startup.unref();
    this.slots.add(slot);
    worker.on("message", (message: { ready?: boolean; id?: number; report?: ValidationReport }) => {
      if (slot.dead) return;
      if (message?.ready === true && !slot.ready) {
        slot.ready = true;
        clearTimeout(slot.startup);
        if (slot.job) this.dispatch(slot);
        return;
      }
      const job = slot.job;
      if (
        !job ||
        message?.id !== job.id ||
        typeof message.report?.conforms !== "boolean" ||
        !Array.isArray(message.report.results)
      ) {
        void this.retire(slot, new Error("Validation worker sent an invalid message"));
      } else if (performance.now() >= job.deadline) {
        this.expire(job);
      } else {
        clearTimeout(job.timer);
        slot.job = undefined;
        worker.unref();
        job.resolve(message.report);
        this.pump();
      }
    });
    worker.on("messageerror", (error: Error) => {
      void this.retire(
        slot,
        new Error(`Validation worker message deserialization error: ${String(error)}`),
      );
    });
    worker.on("error", (error: Error) => {
      void this.retire(
        slot,
        new Error(`Validation worker failed: ${error.message}; check workerUrl/workerFactory`),
      );
    });
    worker.on("exit", (code: number) => {
      void this.retire(slot, new Error(`Validation worker exited without a report (code ${code})`));
    });
    // Registering message handlers refs the port: unref only after all listeners exist.
    worker.unref();
  }

  private dispatch(slot: Slot): void {
    const job = slot.job as Job;
    if (performance.now() >= job.deadline) {
      this.expire(job);
      return;
    }
    try {
      const request: ValidationWorkerRequest = {
        id: job.id,
        data: encodeValidationQuads(job.data),
        shapes: encodeValidationQuads(job.shapes),
      };
      // Serialization and a delayed parent timer must never admit a late success.
      if (performance.now() >= job.deadline) {
        this.expire(job);
        return;
      }
      slot.worker.postMessage(request);
    } catch (error) {
      void this.retire(slot, new Error(`Validation worker transfer failed: ${String(error)}`));
    }
  }

  private expire(job: Job): void {
    const slot = [...this.slots].find((candidate) => candidate.job === job);
    if (slot) {
      void this.retire(slot, timeoutError(job.timeoutMs));
      return;
    }
    const index = this.queue.indexOf(job);
    if (index === -1) return;
    this.queue.splice(index, 1);
    clearTimeout(job.timer);
    job.reject(timeoutError(job.timeoutMs));
  }

  private retire(slot: Slot, error: Error): Promise<void> {
    if (slot.dead) return Promise.resolve();
    slot.dead = true;
    clearTimeout(slot.startup);
    const job = slot.job;
    slot.job = undefined;
    if (job) clearTimeout(job.timer);
    this.slots.delete(slot);
    const termination = (async () => {
      try {
        await slot.worker.terminate();
      } catch (failure) {
        error = new Error(`Validation worker termination failed: ${String(failure)}`);
      } finally {
        slot.worker.removeAllListeners();
        job?.reject(error);
      }
    })();
    this.retiring.add(termination);
    void termination.then(() => {
      this.retiring.delete(termination);
      this.pump();
    });
    return termination;
  }

  /** Reject queued/active calls and await termination. Closed instances cannot be reused. */
  async close(): Promise<void> {
    this.closed = true;
    const error = new Error("Validation worker pool is closed");
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    for (const slot of this.slots) void this.retire(slot, error);
    await Promise.all(this.retiring);
  }
}

let defaultPool: ValidationWorkerPool | undefined;
export function runValidationWorker(
  data: readonly Quad[],
  shapes: readonly Quad[],
  deadline: number,
  timeoutMs: number,
  pool?: ValidationWorkerPool,
): Promise<ValidationReport> {
  if (pool) return pool.run(data, shapes, deadline, timeoutMs);
  defaultPool ??= new ValidationWorkerPool();
  return defaultPool.run(data, shapes, deadline, timeoutMs);
}

/** Shut down the shared pool; a later validateIntent call lazily creates a new one. */
export async function closeValidationPool(): Promise<void> {
  const pool = defaultPool;
  defaultPool = undefined;
  await pool?.close();
}
