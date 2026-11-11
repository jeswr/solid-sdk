// AUTHORED-BY Codex GPT-6.1-Sol
import type { Worker, WorkerOptions } from "node:worker_threads";
import type { BlankNode, Quad } from "@rdfjs/types";
import type { ValidationReport } from "./types.js";
import { checkedQuads } from "./validationLimits.js";
import { encodeValidationQuads } from "./validationTransfer.js";

export interface ValidationWorkerRequest {
  id: number;
  data: string;
  shapes: string;
}

/** The factory must return a fresh Node-compatible Worker speaking the shipped protocol. */
export type ValidationWorkerFactory = (url: URL, options: WorkerOptions) => Worker;

export interface ValidationWorkerPoolOptions {
  /** Concurrent workers, 1–8. Defaults to min(2, availableParallelism()). */
  readonly size?: number;
  /** Waiting calls beyond occupied workers, 0–65536 (default 64). */
  readonly maxQueueSize?: number;
  /** Independent ready-handshake limit, integer 1–2147483647 ms (default 10000). */
  readonly startupTimeoutMs?: number;
  /** Copy the shipped validationWorker.js here when bundling the main entry. */
  readonly workerUrl?: URL;
  readonly workerFactory?: ValidationWorkerFactory;
}

type Job = {
  id: number;
  data: readonly Quad[];
  shapes: readonly Quad[];
  shapeKey: object;
  deadline: number;
  timeoutMs: number;
  posted: boolean;
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
  retirement?: Promise<void>;
  finishRetirement?: () => void;
};
const TERMINATION_GRACE_MS = 100;
type Runner = (
  data: readonly Quad[],
  shapes: readonly Quad[],
  deadline: number,
  timeoutMs: number,
  shapeKey: object,
) => Promise<ValidationReport>;
// Only the capped validateIntent adapter can submit work. No public pool.run bypass.
const runners = new WeakMap<ValidationWorkerPool, Runner>();
const timeoutError = (ms: number) => new Error(`Validation exceeded ${ms} ms wall-clock limit`);

type ShapeTransfer = { terms: string[]; encoded: string; blankNodes: Map<string, BlankNode> };
// Key by the original ProtocolDocument/array/dataset, not the preflight's copy.
const shapeTransfers = new WeakMap<object, ShapeTransfer>();
function shapeTerms(quads: readonly Quad[]): string[] {
  const terms: string[] = [];
  for (const q of quads) {
    for (const term of [q.subject, q.predicate, q.object, q.graph]) {
      terms.push(term.termType, term.value);
      if (term.termType === "Literal") {
        terms.push(
          term.datatype.value,
          term.language,
          (term as typeof term & { direction?: string }).direction ?? "",
        );
      }
    }
  }
  return terms;
}

/** Lazily warmed, bounded workers. Retired slots count until termination or exit. */
export class ValidationWorkerPool {
  private readonly options: ValidationWorkerPoolOptions;
  private readonly queue: Job[] = [];
  private readonly slots = new Set<Slot>();
  private initialization?: Promise<void>;
  private factory?: ValidationWorkerFactory;
  private size = 2;
  private entering = 0;
  private nextId = 0;
  private closed = false;

  constructor(options: ValidationWorkerPoolOptions = {}) {
    for (const [name, value, min, max] of [
      ["size", options.size, 1, 8],
      ["maxQueueSize", options.maxQueueSize, 0, 65_536],
      ["startupTimeoutMs", options.startupTimeoutMs, 1, 2_147_483_647],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
        throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
      }
    }
    this.options = { ...options };
    this.size = options.size ?? 2;
    runners.set(this, (data, shapes, deadline, timeoutMs, shapeKey) =>
      this.#run(data, shapes, deadline, timeoutMs, shapeKey),
    );
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

  /** Input is already capped by intentQuads/shapeQuads on the calling thread. */
  async #run(
    data: readonly Quad[],
    shapes: readonly Quad[],
    deadline: number,
    timeoutMs: number,
    shapeKey: object,
  ): Promise<ValidationReport> {
    if (this.closed) throw new Error("Validation worker pool is closed");
    const reserved = [...this.slots].filter((slot) => slot.dead || slot.job !== undefined).length;
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
    const occupied = [...this.slots].filter((slot) => slot.dead || slot.job !== undefined).length;
    if (occupied + this.queue.length >= this.size + (this.options.maxQueueSize ?? 64)) {
      throw new Error("Validation worker queue is full");
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.nextId,
        data,
        shapes,
        shapeKey,
        deadline,
        timeoutMs,
        posted: false,
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
    while (this.slots.size < this.size) {
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
      if (slot.dead || slot.job || !slot.ready) continue;
      const job = this.queue.shift();
      if (!job) break;
      slot.job = job;
      slot.worker.ref();
      this.dispatch(slot);
    }
  }

  private startSlot(): void {
    const worker = (this.factory as ValidationWorkerFactory)(
      this.options.workerUrl ?? new URL("./validationWorker.js", import.meta.url),
      {
        resourceLimits: {
          // Text is only part of the footprint: parsed terms, named graph
          // indexes, validation views and temporary copies coexist. Review
          // probes saw ~178 MB used heap at both quad/character caps; 512 MiB
          // gives roughly 3x that observation, not a guaranteed 8x margin.
          maxOldGenerationSizeMb: 512,
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
        void this.retire(
          slot,
          new Error(
            `Validation worker startup exceeded ${this.options.startupTimeoutMs ?? 10_000} ms; check workerUrl/workerFactory`,
          ),
        );
      }, this.options.startupTimeoutMs ?? 10_000),
    };
    slot.startup.unref();
    this.slots.add(slot);
    worker.on("message", (message: { ready?: boolean; id?: number; report?: ValidationReport }) => {
      if (slot.dead) return;
      if (message?.ready === true && !slot.ready) {
        slot.ready = true;
        clearTimeout(slot.startup);
        this.pump();
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
      this.release(slot);
      slot.finishRetirement?.();
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
      // RDF/JS types are readonly, but caller objects may change while queued
      // or during startup. Recheck before any Writer or cache access.
      checkedQuads(job.data, false);
      checkedQuads(job.shapes, true);
      const terms = shapeTerms(job.shapes);
      const cached = shapeTransfers.get(job.shapeKey);
      let shapes =
        cached &&
        cached.terms.length === terms.length &&
        cached.terms.every((term, i) => term === terms[i])
          ? cached
          : undefined;
      // Shapes seed one map so their encoding can be reused with any data.
      // Clone it per request: data-only blank nodes must not pollute the cache.
      const blankNodes = new Map(shapes?.blankNodes);
      if (performance.now() >= job.deadline) {
        this.expire(job);
        return;
      }
      if (!shapes) {
        shapes = {
          terms,
          encoded: encodeValidationQuads(job.shapes, blankNodes),
          blankNodes: new Map(blankNodes),
        };
        shapeTransfers.set(job.shapeKey, shapes);
      }
      if (performance.now() >= job.deadline) {
        this.expire(job);
        return;
      }
      const request: ValidationWorkerRequest = {
        id: job.id,
        data: encodeValidationQuads(job.data, blankNodes),
        shapes: shapes.encoded,
      };
      // Serialization and a delayed parent timer must never admit a late success.
      if (performance.now() >= job.deadline) {
        this.expire(job);
        return;
      }
      job.posted = true;
      slot.worker.postMessage(request);
    } catch (error) {
      void this.retire(slot, new Error(`Validation worker transfer failed: ${String(error)}`));
    }
  }

  private expire(job: Job): void {
    const slot = [...this.slots].find((candidate) => candidate.job === job);
    if (slot) {
      if (job.posted) {
        void this.retire(slot, timeoutError(job.timeoutMs));
      } else {
        // The caller's budget can expire during encoding, before any worker work.
        slot.job = undefined;
        slot.worker.unref();
        clearTimeout(job.timer);
        job.reject(timeoutError(job.timeoutMs));
        // Many queued deadlines can pass together while the parent timer is
        // delayed. Continue without recursively dispatching an entire queue.
        queueMicrotask(() => this.pump());
      }
      return;
    }
    const index = this.queue.indexOf(job);
    if (index === -1) return;
    this.queue.splice(index, 1);
    clearTimeout(job.timer);
    job.reject(timeoutError(job.timeoutMs));
  }

  /** Release capacity only after terminate succeeds or an exit is observed. */
  private release(slot: Slot): void {
    if (!this.slots.delete(slot)) return;
    slot.worker.removeAllListeners();
    this.pump();
  }

  private retire(slot: Slot, error: Error): Promise<void> {
    if (slot.retirement) return slot.retirement;
    slot.dead = true;
    clearTimeout(slot.startup);
    const job = slot.job;
    slot.job = undefined;
    if (job) clearTimeout(job.timer);
    // A failed handshake has no assigned job: refuse waiting callers, rather
    // than endlessly rebuilding cold workers until their individual deadlines.
    const waiting = slot.ready ? [] : this.queue.splice(0);
    for (const queued of waiting) clearTimeout(queued.timer);
    slot.retirement = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(grace);
        job?.reject(error);
        for (const queued of waiting) queued.reject(error);
        resolve();
      };
      const grace = setTimeout(finish, TERMINATION_GRACE_MS);
      slot.finishRetirement = finish;
      // Defer invocation until retirement is registered, even for synchronous
      // factories. A rejected/hung terminate keeps this dead slot against size.
      void Promise.resolve()
        .then(() => slot.worker.terminate())
        .then(
          () => {
            this.release(slot);
            finish();
          },
          (failure) => {
            error = new Error(`Validation worker termination failed: ${String(failure)}`);
            finish();
          },
        );
    });
    return slot.retirement;
  }

  /** Refuse pending calls and await termination with bounded grace. Instances stay closed. */
  async close(): Promise<void> {
    this.closed = true;
    const error = new Error("Validation worker pool is closed");
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    await Promise.all([...this.slots].map((slot) => this.retire(slot, error)));
  }
}

let defaultPool: ValidationWorkerPool | undefined;
export function runValidationWorker(
  data: readonly Quad[],
  shapes: readonly Quad[],
  deadline: number,
  timeoutMs: number,
  pool?: ValidationWorkerPool,
  shapeKey: object = shapes,
): Promise<ValidationReport> {
  if (!pool) defaultPool ??= new ValidationWorkerPool();
  const selected = pool ?? (defaultPool as ValidationWorkerPool);
  return (runners.get(selected) as Runner)(data, shapes, deadline, timeoutMs, shapeKey);
}

/** Shut down the shared pool; a later validateIntent call lazily creates a new one. */
export async function closeValidationPool(): Promise<void> {
  const pool = defaultPool;
  defaultPool = undefined;
  await pool?.close();
}
