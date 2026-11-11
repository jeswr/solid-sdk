// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import type { Nanopublication } from "./model.js";
import { graph, NS, RdfNode } from "./rdf.js";

/** Batch-scoped context retains only source/entity graphs, never other envelopes. */
export function correspondenceBatches(np: Nanopublication, dataset: DatasetCore): Set<string> {
  const batches = new Set([np.batch]);
  for (const term of new RdfNode(np.id, graph(dataset, np.provenanceId)).terms(
    `${NS.pkg}correspondenceBatch`,
  )) {
    if (term.termType !== "Literal" || term.datatype.value !== `${NS.xsd}string`)
      throw new Error("Expected a correspondence batch string");
    batches.add(term.value);
  }
  return batches;
}
