// AUTHORED-BY Claude Opus 5.5
import { createHash } from "node:crypto";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory as df, termToId } from "n3";
import { correspondenceBatches } from "./correspondence.js";
import { pkgId } from "./ids.js";
import type { Nanopublication, Nanopublications } from "./model.js";
import { compactStore, type ReferenceStore } from "./rdf.js";

// N3 accepts external RDF/JS terms; @types/n3 narrows this helper to N3 terms.
const termKey = termToId as (term: Term) => string;

/** Blank nodes allowed in one graph that both inputs hold; more are refused. */
export const MAX_SHARED_GRAPH_BLANK_NODES = 1024;
/** Refinement rounds allowed to tell a shared graph's blank nodes apart. */
export const MAX_SHARED_GRAPH_ROUNDS = 32;

interface Input {
  prefix: string;
  graphs: Map<string, Quad[]>;
  declared: Set<string>;
}

function refuse(): never {
  throw new Error("Conflicting nanopublication merge");
}

/** Every graph a nanopub reads: its envelope and its batch source/entity graphs. */
function declaredGraphs(value: Nanopublications): Set<string> {
  const declared = new Set<string>();
  for (const np of value.nanopubs) {
    for (const name of [np.id, np.assertionId, np.provenanceId, np.pubinfoId]) declared.add(name);
    for (const batch of correspondenceBatches(np, value.dataset))
      for (const kind of ["sources", "entities"]) declared.add(pkgId("batch", batch, kind));
  }
  return declared;
}

/** Only graphs some nanopub in the result reads; undeclared and default-graph data is dropped. */
function input(value: Nanopublications, prefix: string, names: Set<string>): Input {
  const graphs = new Map<string, Quad[]>();
  for (const name of names) {
    const quads = [...value.dataset.match(null, null, null, df.namedNode(name))];
    if (quads.length) graphs.set(name, quads);
  }
  return { prefix, graphs, declared: declaredGraphs(value) };
}

/**
 * Label each blank node by its neighbourhood, refining for at most
 * MAX_SHARED_GRAPH_ROUNDS linear passes. Returns undefined unless every blank
 * node ends with a distinct label (tied nodes are not told apart, so the graph is
 * treated as different and the merge refused).
 */
function blankSignatures(quads: Quad[], blanks: Set<string>): Map<string, string> | undefined {
  const edges = new Map<string, [string, Quad][]>([...blanks].map((b) => [b, []]));
  for (const q of quads) {
    if (q.subject.termType === "BlankNode")
      (edges.get(q.subject.value) as [string, Quad][]).push(["o", q]);
    if (q.object.termType === "BlankNode")
      (edges.get(q.object.value) as [string, Quad][]).push(["s", q]);
  }
  let signatures = new Map([...blanks].map((b) => [b, ""]));
  let distinct = 1;
  for (let round = 0; round < MAX_SHARED_GRAPH_ROUNDS; round++) {
    const label = (t: Term) =>
      t.termType === "BlankNode" ? `_${signatures.get(t.value)}` : termKey(t);
    const next = new Map<string, string>();
    for (const [blank, incident] of edges) {
      const entries = incident
        .map(([direction, q]) =>
          JSON.stringify([
            direction,
            termKey(q.predicate),
            label(direction === "o" ? q.object : q.subject),
          ]),
        )
        .sort();
      next.set(blank, createHash("sha256").update(entries.join("\n")).digest("hex"));
    }
    signatures = next;
    const count = new Set(next.values()).size;
    if (count === blanks.size) return signatures;
    if (count === distinct) return undefined;
    distinct = count;
  }
  return undefined;
}

/**
 * Blank-free graphs compare as quad sets. Otherwise both need the same linear
 * shape, at most MAX_SHARED_GRAPH_BLANK_NODES blank nodes, and blank nodes that
 * bounded refinement tells apart; the induced one-to-one mapping must then carry
 * every quad of one graph onto the other. Work is linear per round, and anything
 * outside these bounds counts as different, so the merge is refused.
 */
function sameGraph(left: Quad[], right: Quad[]): boolean {
  if (left.length !== right.length) return false;
  const shape = (quads: Quad[], blanks: Set<string>) =>
    quads
      .map((q) =>
        JSON.stringify(
          [q.subject, q.predicate, q.object].map((t) => {
            if (t.termType !== "BlankNode") return termKey(t);
            blanks.add(t.value);
            return null;
          }),
        ),
      )
      .sort();
  const leftBlanks = new Set<string>(),
    rightBlanks = new Set<string>();
  const a = shape(left, leftBlanks);
  if (leftBlanks.size > MAX_SHARED_GRAPH_BLANK_NODES) return false;
  const b = shape(right, rightBlanks);
  if (leftBlanks.size !== rightBlanks.size || a.some((key, i) => key !== b[i])) return false;
  if (!leftBlanks.size) return true;
  const leftSignatures = blankSignatures(left, leftBlanks);
  const rightSignatures = blankSignatures(right, rightBlanks);
  if (!leftSignatures || !rightSignatures) return false;
  const bySignature = new Map([...rightSignatures].map(([blank, sig]) => [sig, blank]));
  const mapping = new Map<string, string>();
  for (const [blank, sig] of leftSignatures) {
    const target = bySignature.get(sig);
    if (target === undefined) return false;
    mapping.set(blank, target);
  }
  const keys = (quads: Quad[], rename: (label: string) => string | undefined) =>
    quads
      .map((q) =>
        JSON.stringify(
          [q.subject, q.predicate, q.object].map((t) =>
            t.termType === "BlankNode" ? `_:${rename(t.value)}` : termKey(t),
          ),
        ),
      )
      .sort();
  const mapped = keys(left, (label) => mapping.get(label)),
    expected = keys(right, (label) => label);
  return mapped.every((key, i) => key === expected[i]);
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
 * collide. Only graphs that some nanopub reads are kept: undeclared graphs and
 * default-graph data are dropped, so planted data cannot block a later merge.
 * Where a graph is in both inputs the first argument's copy is kept. Shared
 * blank-node graphs are compared within fixed node and work bounds. `affected`
 * is the union of both inputs' lists. Any refusal throws one fixed error with
 * no values.
 */
export function mergeNanopublications(a: Nanopublications, b: Nanopublications): Nanopublications {
  try {
    const names = new Set([...declaredGraphs(a), ...declaredGraphs(b)]);
    const left = input(a, "m0_", names),
      right = input(b, "m1_", names);
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
          for (const t of [q.subject, q.object]) if (t.termType === "BlankNode") kept.add(t.value);
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
              df.quad(relabel(q.subject, prefix), q.predicate, relabel(q.object, prefix), q.graph),
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
