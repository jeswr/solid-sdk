// AUTHORED-BY Codex GPT-6.1-Sol
import type { Worker } from "node:worker_threads";
import { afterAll, vi } from "vitest";

const workerTest = vi.hoisted(() => ({
  workers: [] as Worker[],
  delayMs: 0,
  started: new SharedArrayBuffer(4),
  crash: false,
  exitEarly: false,
  failConstruction: false,
  messageError: false,
  missingThreads: false,
}));

export { workerTest };

vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:worker_threads")>();
  return {
    ...actual,
    // biome-ignore lint/style/useNamingConvention: Node export name.
    get Worker() {
      if (workerTest.missingThreads) return undefined;
      return class extends actual.Worker {
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
          if (workerTest.messageError)
            this.once("online", () =>
              this.emit("messageerror", new Error("simulated deserialize error")),
            );
          workerTest.workers.push(this);
          vi.spyOn(this, "terminate");
        }
      };
    },
  };
});

// Each file gets an isolated module graph; release its shared pool explicitly.
afterAll(async () => {
  const { closeValidationPool } = await import("../src/index.js");
  await closeValidationPool();
});
