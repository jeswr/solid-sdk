// AUTHORED-BY Codex GPT-6.1-Sol
import type { Worker } from "node:worker_threads";
import { vi } from "vitest";

const workerTest = vi.hoisted(() => ({
  workers: [] as Worker[],
  delayMs: 0,
  started: new SharedArrayBuffer(4),
  crash: false,
  exitEarly: false,
  failConstruction: false,
}));

export { workerTest };

vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  return {
    ...actual,
    Worker: class extends actual.Worker {
      constructor(filename: string | URL, options?: import("node:worker_threads").WorkerOptions) {
        if (workerTest.failConstruction) throw new Error("simulated worker startup failure");
        // Native workers cannot run Vitest's transformed TypeScript. Exercise the
        // shipped worker artifact, which the gate builds before running tests.
        const workerUrl = new URL("../dist/validationWorker.js", import.meta.url);
        super(new URL("./fixtures/validation-worker.mjs", import.meta.url), {
          ...options,
          workerData: {
            ...options?.workerData,
            actualWorker:
              filename instanceof URL && filename.pathname.includes("/src/")
                ? workerUrl.href
                : String(filename),
            delayMs: workerTest.delayMs,
            started: workerTest.started,
            crash: workerTest.crash,
            exitEarly: workerTest.exitEarly,
          },
        });
        workerTest.workers.push(this);
        vi.spyOn(this, "terminate");
      }
    },
  };
});
