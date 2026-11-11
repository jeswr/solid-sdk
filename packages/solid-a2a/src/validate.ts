// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Quad } from "@rdfjs/types";
import type { Intent, ProtocolDocument, ValidationReport } from "./types.js";
import { validateGraphs } from "./validationCore.js";
import { intentQuads, shapeQuads } from "./validationInputs.js";
import { runValidationWorker, type ValidationWorkerPool } from "./validationWorkerClient.js";

/** A SHACL shape supplied as quads, a dataset, or a built {@link ProtocolDocument}. */
export type ShapeInput = readonly Quad[] | DatasetCore | ProtocolDocument;

/** An intent supplied as a structured {@link Intent}, its quads, or a dataset. */
export type IntentInput = Intent | readonly Quad[] | DatasetCore;

/** Resource limits for one {@link validateIntent} call. */
export interface ValidationOptions {
  /**
   * Node worker wall-clock limit in milliseconds, including queue wait and startup (default 2000).
   * Must be an integer from 1 to 2147483647. Browsers retain synchronous metering;
   * this option does not provide a browser wall-clock guarantee.
   */
  readonly timeoutMs?: number;
  /** Explicitly opt into synchronous metering without a wall-clock guarantee. */
  readonly execution?: "worker" | "in-process";
  /** Reuse a configured pool, for concurrency limits or bundled worker locations. */
  readonly workerPool?: ValidationWorkerPool;
}

/**
 * SHACL-validate an intent against a shape or a Protocol Document's request shape.
 * Node runs validation in a bounded reusable worker pool with a wall-clock limit;
 * browsers use the same metered checks synchronously. Input lowering and transfer
 * are capped on the calling thread. Always await the returned promise.
 *
 * @returns a structured report; non-conformance, timeout, invalid options and
 * worker failures all return `conforms: false`, never throw.
 */
export async function validateIntent(
  intent: IntentInput,
  shape: ShapeInput,
  options: ValidationOptions = {},
): Promise<ValidationReport> {
  try {
    const timeoutMs = options.timeoutMs ?? 2_000;
    const deadline = performance.now() + timeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
      throw new TypeError("timeoutMs must be an integer between 1 and 2147483647");
    }
    if (
      options.execution !== undefined &&
      options.execution !== "worker" &&
      options.execution !== "in-process"
    ) {
      throw new TypeError('execution must be "worker" or "in-process"');
    }
    if (
      options.execution !== "in-process" &&
      (options.execution === "worker" || (typeof process !== "undefined" && process.versions?.node))
    ) {
      // A Node worker failure must never fall back to blocking this thread.
      return await runValidationWorker(
        intentQuads(intent),
        shapeQuads(shape),
        deadline,
        timeoutMs,
        options.workerPool,
      );
    }
    return await validateGraphs(intentQuads(intent), shapeQuads(shape));
  } catch (error) {
    return {
      conforms: false,
      results: [{ message: error instanceof Error ? error.message : String(error) }],
    };
  }
}
