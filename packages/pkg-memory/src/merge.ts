// AUTHORED-BY Claude Opus 5.5
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory as df, termToId } from "n3";
import { correspondenceBatches } from "./correspondence.js";
import { canonicalizeGraphWithLabels, pkgId } from "./ids.js";
import type { Nanopublication, Nanopublications } from "./model.js";
import { compactStore, ReferenceStore } from "./rdf.js";

// N3 accepts external RDF/JS terms; @types/n3 narrows this helper to N3 terms.
const termKey = termToId as (term: Term) => string;

interface Input {
  value: Nanopublications;
  prefix: string;
  graphs: Map<string, Quad[]>;
  declared: Set<string>;
}

/** Named graphs are global; default and blank-named graphs never match across inputs. */
function graphKey(term: Term, prefix: string): string {
  if (term.termType === "NamedNode") return `N${term.value}`;
  return term.termType === "DefaultGraph" ? "D" : `B${prefix}${term.value}`;
}

function refuse(): never {
  throw new Error("Conflicting nanopublication merge");
}

function input(value: Nanopublications, prefix: string): Input {
  const graphs = new Map<string, Quad[]>();
  for (const quad of value.dataset) {
    const key = graphKey(quad.graph, prefix);
    let quads = graphs.get(key);
    if (!quads) {
      quads = [];
      graphs.set(key, quads);
    }
    quads.push(quad);
  }
  // Every graph a nanopub reads: its envelope and its batch source/entity graphs.
  const declared = new Set<string>();
  for (const np of value.nanopubs) {
    for (const name of [np.id, np.assertionId, np.provenanceId, np.pubinfoId])
      declared.add(`N${name}`);
    for (const batch of correspondenceBatches(np, value.dataset))
      for (const kind of ["sources", "entities"]) declared.add(`N${pkgId("batch", batch, kind)}`);
  }
  return { value, prefix, graphs, declared };
}

/** Blank-free graphs compare as quad sets; others by canonical labelling, after a linear shape check. */
function sameGraph(left: Quad[], right: Quad[]): boolean {
  if (left.length !== right.length) return false;
  let blank = false;
  const shape = (quads: Quad[]) =>
    quads
      .map((q) =>
        JSON.stringify(
          [q.subject, q.predicate, q.object].map((t) => {
            if (t.termType !== "BlankNode") return termKey(t);
            blank = true;
            return null;
          }),
        ),
      )
      .sort();
  const a = shape(left),
    b = shape(right);
  if (a.some((key, i) => key !== b[i])) return false;
  if (!blank) return true;
  const canonical = (quads: Quad[]) =>
    canonicalizeGraphWithLabels(
      new ReferenceStore(quads.map((q) => df.quad(q.subject, q.predicate, q.object))),
    ).id;
  return canonical(left) === canonical(right);
}

function relabel<T extends Term>(term: T, prefix: string): T {
  return (term.termType === "BlankNode" ? df.blankNode(`${prefix}${term.value}`) : term) as T;
}

/**
 * Union two parsed nanopublication values without letting either rewrite the other.
 *
 * A graph present in both inputs must have the same content in both; one copy is
 * kept. A graph that one input's nanopubs read (envelope, assertion or batch
 * source/entity graph) may come from the other input only when the first input
 * holds an identical copy, so a foreign export cannot add a source record to an
 * existing batch by reusing its batch ID. A private envelope graph may belong to
 * only one nanopub. Blank nodes are relabelled per input, so labels never
 * collide. `affected` is the union of both inputs' lists. Any refusal throws one
 * fixed error with no values.
 */
export function mergeNanopublications(a: Nanopublications, b: Nanopublications): Nanopublications {
  try {
    const left = input(a, "m0_"),
      right = input(b, "m1_");
    const owners = new Map<string, string>();
    for (const np of [...a.nanopubs, ...b.nanopubs])
      for (const name of [np.id, np.provenanceId, np.pubinfoId]) {
        const owner = owners.get(name);
        if (owner !== undefined && owner !== np.id) refuse();
        owners.set(name, np.id);
      }
    for (const [mine, other] of [
      [left, right],
      [right, left],
    ] as const)
      for (const name of mine.declared)
        if (other.graphs.has(name) && !mine.graphs.has(name)) refuse();
    const duplicates = new Set<string>();
    for (const [name, quads] of left.graphs) {
      const theirs = right.graphs.get(name);
      if (!theirs) continue;
      if (!sameGraph(quads, theirs)) refuse();
      duplicates.add(name);
    }
    // The second input's copy of a duplicate graph is dropped, so none of its
    // blank nodes may be referenced from a graph that is kept.
    const kept = new Set<string>();
    for (const [name, quads] of right.graphs)
      if (!duplicates.has(name))
        for (const q of quads)
          for (const t of [q.subject, q.object, q.graph])
            if (t.termType === "BlankNode") kept.add(t.value);
    for (const name of duplicates)
      for (const q of right.graphs.get(name) as Quad[])
        if ([q.subject, q.object].some((t) => t.termType === "BlankNode" && kept.has(t.value)))
          refuse();
    const quads: Quad[] = [];
    for (const { graphs, prefix } of [left, right])
      for (const [name, contents] of graphs)
        if (prefix === left.prefix || !duplicates.has(name))
          for (const q of contents)
            quads.push(
              df.quad(
                relabel(q.subject, prefix),
                q.predicate,
                relabel(q.object, prefix),
                relabel(q.graph, prefix),
              ),
            );
    const nanopubs = new Map<string, Nanopublication>();
    for (const np of [...a.nanopubs, ...b.nanopubs])
      if (!nanopubs.has(np.id)) nanopubs.set(np.id, np);
    return {
      dataset: compactStore(quads) as ReferenceStore,
      nanopubs: [...nanopubs.values()].sort((x, y) => (x.id < y.id ? -1 : 1)),
      affected: [...new Set([...(a.affected ?? []), ...(b.affected ?? [])])],
    };
  } catch {
    refuse();
  }
}
