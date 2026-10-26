// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { PodThing } from "./vocab.js";

/** Copy without mutating adapter input or a host-owned read cache. */
export function copyDataset(dataset?: DatasetCore): Store {
  const result = new Store();
  if (dataset) for (const quad of dataset) result.add(quad);
  return result;
}

/** An incoming item replaces its old description; absent items survive incremental pages.
 * Stable schema:identifier takes priority over fragment spelling within the same slug.
 * Adapters must use deterministic subjects and linked-node identifiers (no anonymous item IDs).
 */
export function mergeItems(existing: DatasetCore | undefined, incoming: DatasetCore): Store {
  const result = copyDataset(existing);
  const incomingSubjects = new Set(
    [...incoming].filter((q) => q.subject.termType === "NamedNode").map((q) => q.subject.value),
  );
  const ids = new Set<string>();
  const lastSubjectById = new Map<string, string>();
  const discarded = new Set<string>();
  for (const subject of incomingSubjects) {
    const id = new PodThing(subject, incoming, DataFactory).identifier;
    if (id !== undefined) {
      ids.add(id);
      const previous = lastSubjectById.get(id);
      if (previous) discarded.add(previous);
      lastSubjectById.set(id, subject);
    }
  }
  const replaced = new Set(incomingSubjects);
  const oldSubjects = new Set(
    [...result].filter((q) => q.subject.termType === "NamedNode").map((q) => q.subject.value),
  );
  for (const subject of oldSubjects) {
    const id = new PodThing(subject, result, DataFactory).identifier;
    if (id !== undefined && ids.has(id)) replaced.add(subject);
  }
  for (const quad of [...result]) if (replaced.has(quad.subject.value)) result.delete(quad);
  for (const quad of incoming) {
    if (quad.subject.termType !== "NamedNode" || !discarded.has(quad.subject.value))
      result.add(quad);
  }
  return result;
}
