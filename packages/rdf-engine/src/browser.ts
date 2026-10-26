// AUTHORED-BY Codex GPT-6.1-Sol
export { createRdfEngine } from "./index.js";
export type * from "./types.js";

/** Resolve the content-hashed filename emitted by copy-wasm against a public asset directory. */
export function wasmUrl(
  fileName: string,
  publicPath: string | URL = new URL("./wasm/", import.meta.url),
): URL {
  return new URL(fileName, publicPath);
}
