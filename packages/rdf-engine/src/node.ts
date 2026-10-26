// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createEngine } from "./engine.js";
import type { RdfEngine } from "./types.js";

export { FormGraphUnsupportedError, PolicyIdentifierCollisionError } from "./errors.js";
export type * from "./types.js";

/** Use the prebuilt Node WASM module; its synchronous initialization occurs lazily. */
export function createRdfEngine(): RdfEngine {
  return createEngine(() => import("@sparq-org/sparq/wasm-node"));
}
