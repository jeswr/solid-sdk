// AUTHORED-BY Codex (GPT-6.1 Sol)
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { V } from "./vocab.js";

/** Canonicalise vocabulary only, preserving resource IDs, literals and graph names. */
export function migrateMoney(dataset: DatasetCore): DatasetCore {
  for (const quad of [...dataset]) {
    let predicate = canonicalize(quad.predicate.value);
    if (predicate === `${NS.POD_MONEY}parent`) predicate = V.parent;
    let object = quad.object;
    if (predicate === V.type && object.termType === "NamedNode") {
      let type = canonicalize(object.value);
      if (type === `${NS.POD_MONEY}Category`) type = V.categoryClass;
      object = DataFactory.namedNode(type);
    }
    if (predicate === quad.predicate.value && object.equals(quad.object)) continue;
    const graph =
      quad.graph.termType === "DefaultGraph"
        ? dataset
        : new NamedGraphDataset(quad.graph, dataset, DataFactory);
    const node = new TermWrapper(quad.subject, graph, DataFactory);
    SetFrom.subjectPredicate(node, predicate, TermAs.term, TermFrom.itself).add(object);
    dataset.delete(quad);
  }
  return dataset;
}
