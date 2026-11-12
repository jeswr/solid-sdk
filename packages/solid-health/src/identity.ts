// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory } from "n3";

/** Read-only focus adapter: the generated composite recognises #it; importers
 * supply deterministic observation IRIs. Delegate original quads unchanged so
 * datatype, cardinality and linked-node validation all see the original terms.
 * No graph rewriting, field copying, sanitization or fabricated triples.
 */
export function focusDataset(dataset: DatasetCore, virtual: string, actual: string): DatasetCore {
  return {
    size: dataset.size,
    [Symbol.iterator]: () => dataset[Symbol.iterator](),
    has: (quad) => dataset.has(quad),
    add() {
      throw new TypeError("Observation focus is read-only");
    },
    delete() {
      throw new TypeError("Observation focus is read-only");
    },
    match(subject, predicate, object, graph) {
      return dataset.match(
        subject?.termType === "NamedNode" && subject.value === virtual
          ? DataFactory.namedNode(actual)
          : subject,
        predicate,
        object,
        graph,
      );
    },
  };
}
