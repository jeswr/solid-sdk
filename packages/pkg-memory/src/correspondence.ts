// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory as df } from "n3";
import type { Nanopublication } from "./model.js";
import { NS } from "./rdf.js";

/** Batch-scoped context retains only source/entity graphs, never other envelopes.
 * Reads the provenance graph in place (no copy), so large exports stay linear.
 */
export function correspondenceBatches(np: Nanopublication, dataset: DatasetCore): Set<string> {
  const batches = new Set([np.batch]);
  for (const q of dataset.match(
    df.namedNode(np.id),
    df.namedNode(`${NS.pkg}correspondenceBatch`),
    null,
    df.namedNode(np.provenanceId),
  )) {
    const term = q.object;
    if (term.termType !== "Literal" || term.datatype.value !== `${NS.xsd}string`)
      throw new Error("Expected a correspondence batch string");
    batches.add(term.value);
  }
  return batches;
}
