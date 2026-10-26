// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createRdfEngine as createBaseEngine } from "./index.js";
import { createIndexedDbPersistence } from "./indexeddb.js";
import type { RdfEngine, RdfEngineOptions } from "./types.js";

export {
  FormGraphUnsupportedError,
  PolicyIdentifierCollisionError,
  PolicySubjectUnsupportedError,
} from "./errors.js";
export type { IndexedDbPersistenceOptions } from "./indexeddb.js";
export { createIndexedDbPersistence } from "./indexeddb.js";

/** Browser indexes persist to IndexedDB by default; pass persist to select another store/key. */
export function createRdfEngine(opts: RdfEngineOptions = {}): RdfEngine {
  const engine = createBaseEngine(opts);
  const createIndex = engine.createIndex;
  engine.createIndex = (options) =>
    createIndex({ ...options, persist: options?.persist ?? createIndexedDbPersistence() });
  return engine;
}
export type * from "./types.js";

/** Resolve the content-hashed filename emitted by copy-wasm against a public asset directory. */
export function wasmUrl(
  fileName: string,
  publicPath: string | URL = new URL("./wasm/", import.meta.url),
): URL {
  return new URL(fileName, publicPath);
}
