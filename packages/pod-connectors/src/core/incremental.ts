// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";

/** Copy without mutating adapter input or a host-owned read cache. */
export function copyDataset(dataset?: DatasetCore): Store {
  const result = new Store();
  if (dataset) for (const quad of dataset) result.add(quad);
  return result;
}

/** An incoming subject replaces its old description; absent subjects survive incremental pages.
 * Adapters must use deterministic subjects and linked-node identifiers (no anonymous item IDs).
 * schema:identifier is descriptive metadata and need not uniquely identify a subject.
 */
export function mergeItems(existing: DatasetCore | undefined, incoming: DatasetCore): Store {
  const result = copyDataset(existing);
  const incomingSubjects = new Set(
    [...incoming].filter((q) => q.subject.termType === "NamedNode").map((q) => q.subject.value),
  );
  for (const quad of [...result])
    if (quad.subject.termType === "NamedNode" && incomingSubjects.has(quad.subject.value))
      result.delete(quad);
  for (const quad of incoming) result.add(quad);
  return result;
}
