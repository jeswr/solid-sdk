// AUTHORED-BY Codex GPT-6.1-Sol
import { createEngine } from "./engine.js";
import type { RdfEngine, RdfEngineOptions } from "./types.js";

export type * from "./types.js";

/** Create an engine without loading WASM. Initialization is shared by concurrent calls. */
export function createRdfEngine(opts: RdfEngineOptions = {}): RdfEngine {
  return createEngine(async () => {
    const sparq = await (opts.loader ?? (() => import("@sparq-org/sparq")))();
    const wasm = await import("@sparq-org/sparq/wasm/sparq_wasm.js");
    if (opts.wasmUrl !== undefined) {
      await wasm.default({ module_or_path: opts.wasmUrl });
    } else {
      await sparq.init();
    }
    return wasm;
  });
}
