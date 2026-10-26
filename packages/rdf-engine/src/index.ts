// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createEngine, type Runtime } from "./engine.js";
import type { RdfEngine, RdfEngineOptions } from "./types.js";

export type * from "./types.js";

// The web binding owns module-global WASM memory, so both initialization paths must share it.
let initialization: Promise<Runtime> | undefined;

function initialize(opts: RdfEngineOptions): Promise<Runtime> {
  initialization ??= (async () => {
    const sparq = await (opts.loader ?? (() => import("@sparq-org/sparq")))();
    const wasm = await import("@sparq-org/sparq/wasm/sparq_wasm.js");
    if (opts.wasmUrl !== undefined) {
      await wasm.default({ module_or_path: opts.wasmUrl });
    } else {
      await sparq.init();
    }
    return wasm;
  })().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

/** Create an engine without loading WASM. Initialization is shared across engine instances. */
export function createRdfEngine(opts: RdfEngineOptions = {}): RdfEngine {
  return createEngine(() => initialize(opts));
}
