// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@rdfjs/types";
import { DataFactory, type Quad as N3Quad } from "n3";
import type { ValidationReport } from "./types.js";

/** N3's plain JSON representation retains term identity across the worker boundary. */
export interface ValidationWorkerData {
  data: string;
  shapes: string;
}

/** A fresh worker isolates each validation, including pre-checks and result projection. */
export async function runValidationWorker(
  data: readonly Quad[],
  shapes: readonly Quad[],
  timeoutMs: number,
): Promise<ValidationReport> {
  // Keep Node builtins lazy so browser consumers can use the metered fallback.
  const { Worker } = await import("node:worker_threads");
  const deadline = performance.now() + timeoutMs;
  // N3 accepts RDF/JS quads at runtime; its declarations require its own class.
  const workerData: ValidationWorkerData = {
    data: JSON.stringify(data.map((quad) => DataFactory.fromQuad(quad as N3Quad))),
    shapes: JSON.stringify(shapes.map((quad) => DataFactory.fromQuad(quad as N3Quad))),
  };
  const worker = new Worker(new URL("./validationWorker.js", import.meta.url), { workerData });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (report?: ValidationReport, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Await termination on every path: returning a report must leave no worker
      // running, even when it posted a result just as the deadline expired.
      void worker.terminate().then(
        () => {
          worker.removeAllListeners();
          if (error) reject(error);
          else resolve(report as ValidationReport);
        },
        (terminationError: unknown) => {
          worker.removeAllListeners();
          reject(new Error(`Validation worker termination failed: ${String(terminationError)}`));
        },
      );
    };
    const timedOut = (): void => {
      finish(undefined, new Error(`Validation exceeded ${timeoutMs} ms wall-clock limit`));
    };
    const timer = setTimeout(timedOut, Math.max(0, deadline - performance.now()));
    worker.once("message", (report: ValidationReport) => {
      // Timers can run late when the parent is busy. Never accept a late success.
      if (performance.now() >= deadline) timedOut();
      else finish(report);
    });
    worker.once("error", (error) => {
      finish(undefined, new Error(`Validation worker failed: ${error.message}`));
    });
    worker.once("exit", (code) => {
      finish(undefined, new Error(`Validation worker exited without a report (code ${code})`));
    });
  });
}
