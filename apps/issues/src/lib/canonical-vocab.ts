// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalize, NS } from "@jeswr/suite-vocab";
import type { DataFactory, DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import { NamedGraphDataset, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";

export function taskTerm(iri: string): string {
  const resolved = canonicalize(iri);
  return resolved.startsWith(NS.TASK) ? resolved : iri;
}

/** Predicate aliases, canonical first. Resource identifiers are never resolved here. */
export function taskAliases(iri: string): string[] {
  const canonical = taskTerm(iri);
  return canonical.startsWith(NS.TASK)
    ? [canonical, `https://w3id.org/jeswr/task#${canonical.slice(NS.TASK.length)}`]
    : [iri];
}

/** Canonicalize a serialization copy, preserving the caller's quads and graph names. */
export function canonicalizeTaskDataset(dataset: DatasetCore, factory: DataFactory): DatasetCore {
  const copy = new Store([...dataset]);
  for (const quad of dataset) {
    const predicate = taskTerm(quad.predicate.value);
    const vocabularyObject =
      predicate === `${NS.RDF}type` ||
      predicate === `${NS.SOLID}forClass` ||
      predicate === `${NS.TASK}trigger` ||
      predicate === `${NS.TASK}action`;
    const object =
      vocabularyObject && quad.object.termType === "NamedNode"
        ? factory.namedNode(taskTerm(quad.object.value))
        : quad.object;
    if (predicate === quad.predicate.value && object.equals(quad.object)) continue;
    const graph =
      quad.graph.termType === "DefaultGraph"
        ? copy
        : new NamedGraphDataset(quad.graph, copy, factory);
    const anchor = new TermWrapper(quad.subject, graph, factory);
    SetFrom.subjectPredicate(anchor, predicate, TermAs.term, TermFrom.itself).add(object);
    copy.delete(quad);
  }
  return copy;
}

/** Tracker and rule readers keep the original dataset; accessors resolve aliases. */
export class TaskTerm extends TermWrapper {}
