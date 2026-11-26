// AUTHORED-BY Codex (GPT-6.1 Sol)
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { PREFIXES } from "./vocab.js";

/** Preserve photo/album/trash terms, including blank-node identity, through n3.Writer. */
export function serializePhotos(dataset: DatasetCore): Promise<string> {
  return serialize([...dataset], { prefixes: PREFIXES });
}
