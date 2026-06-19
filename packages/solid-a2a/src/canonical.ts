// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Deterministic canonical N-Quads serialisation for content-addressing a Protocol
// Document (protocol.ts). The hash MUST be stable across runs / builders / parse
// round-trips, which N-Triples/N-Quads from n3.Writer is NOT (blank-node labels
// and quad order both vary). So we:
//   1. Relabel every blank node to a CANONICAL label derived from its position in
//      the graph (an iterative hash-of-surroundings scheme — a small, dependency-
//      free canonicalisation sufficient for the tree-shaped SHACL shape graphs
//      this package produces).
//   2. Serialise each quad to a canonical N-Quads line with the canonical labels.
//   3. Sort the lines and join.
// The result is byte-identical for two datasets that are isomorphic up to
// blank-node renaming + quad order — exactly the property a content hash needs.
//
// NOTE on scope: this is a pragmatic canonicalisation, not a full URDNA2015
// implementation. It is deterministic and stable for these graphs (and degrades
// gracefully: even where the blank-node hashing cannot fully distinguish two
// nodes, the labels are assigned by a stable sort so the output stays
// reproducible run-to-run). A future upgrade could swap in `rdf-canonize`.

import { createHash } from "node:crypto";
import type { BlankNode, Quad, Term } from "@rdfjs/types";

/** Serialise quads to a canonical, blank-node-normalised, sorted N-Quads string. */
export function canonicalNQuads(quads: readonly Quad[]): string {
  const labels = canonicalBlankLabels(quads);
  const lines = quads.map((q) => quadToLine(q, labels));
  lines.sort();
  return lines.join("\n");
}

/**
 * Assign each blank node a canonical label. Iterative refinement:
 *   - Start every blank node with the same colour.
 *   - Repeatedly recolour each blank node by hashing the multiset of
 *     (predicate, position, neighbour-colour) of every quad it appears in.
 *   - Iterate until colours stabilise (or a bounded number of rounds).
 *   - Assign final labels by sorting blank nodes on (final-colour, then a stable
 *     tiebreak), so two isomorphic graphs get identical labels.
 *
 * Decomposed into the four named pure steps below so the algorithm reads as its
 * own spec; the per-step logic (signal strings, hash input, round bound, sort
 * order) is byte-for-byte the same as the original single-function form, so the
 * assigned labels — and therefore the content hash — are unchanged.
 */
function canonicalBlankLabels(quads: readonly Quad[]): Map<string, string> {
  const blanks = collectBlankNodes(quads);

  // Colour of every blank: seeded identical (so graph STRUCTURE, not the original
  // id, drives the refinement) and refined across bounded rounds.
  let colour = new Map<string, string>();
  for (const b of blanks) {
    colour.set(b, "_:b");
  }

  const rounds = Math.min(blanks.size + 2, 16);
  for (let r = 0; r < rounds; r++) {
    const next = refineRound(blanks, quads, colour);
    const stable = coloursStable(blanks, colour, next);
    colour = next;
    if (stable) {
      break;
    }
  }

  return assignLabels(blanks, colour);
}

/** Every blank-node id appearing in any subject / object / (named-)graph position. */
function collectBlankNodes(quads: readonly Quad[]): Set<string> {
  const blanks = new Set<string>();
  for (const q of quads) {
    if (q.subject.termType === "BlankNode") {
      blanks.add(q.subject.value);
    }
    if (q.object.termType === "BlankNode") {
      blanks.add(q.object.value);
    }
    // The graph term can also be a blank node (a quad in a blank-node-named graph)
    // — include it so named-graph structure participates in the canonical hash.
    if (q.graph?.termType === "BlankNode") {
      blanks.add(q.graph.value);
    }
  }
  return blanks;
}

/** Recolour every blank node once: its new colour = hash of its neighbourhood signals. */
function refineRound(
  blanks: ReadonlySet<string>,
  quads: readonly Quad[],
  colour: ReadonlyMap<string, string>,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const b of blanks) {
    const signals = blankNodeSignals(b, quads, colour);
    const h = createHash("sha256")
      .update(`${colour.get(b)}\n${signals.join("\n")}`, "utf8")
      .digest("hex");
    next.set(b, h);
  }
  return next;
}

/**
 * The sorted multiset of neighbourhood signals for blank node `b`: one signal per
 * quad position (subject / object / named-graph) in which `b` appears, encoding the
 * predicate + the colour of the other terms (so structure, not the original blank
 * id, distinguishes nodes). Sorted so the multiset is order-independent.
 */
function blankNodeSignals(
  b: string,
  quads: readonly Quad[],
  colour: ReadonlyMap<string, string>,
): string[] {
  const signals: string[] = [];
  for (const q of quads) {
    const sub = q.subject.termType === "BlankNode" ? q.subject.value : undefined;
    const obj = q.object.termType === "BlankNode" ? q.object.value : undefined;
    const grp = q.graph?.termType === "BlankNode" ? q.graph.value : undefined;
    // The graph term participates in every position's signal so that two quads
    // differing only by their named graph produce distinct signals.
    const graphSig = q.graph ? termColour(q.graph, colour) : "";
    if (sub === b) {
      signals.push(`s|${q.predicate.value}|${termColour(q.object, colour)}|${graphSig}`);
    }
    if (obj === b) {
      signals.push(`o|${q.predicate.value}|${termColour(q.subject, colour)}|${graphSig}`);
    }
    if (grp === b) {
      signals.push(
        `g|${q.predicate.value}|${termColour(q.subject, colour)}|${termColour(q.object, colour)}`,
      );
    }
  }
  signals.sort();
  return signals;
}

/** True iff no blank node's colour changed between the two rounds (a fixed point). */
function coloursStable(
  blanks: ReadonlySet<string>,
  prev: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): boolean {
  for (const b of blanks) {
    if (next.get(b) !== prev.get(b)) {
      return false;
    }
  }
  return true;
}

/**
 * Final labels: sort blanks by (final-colour, original-id) for a stable total
 * order, then number them c14n-0, c14n-1, … The original-id tiebreak keeps the
 * output reproducible even when two blanks share a colour (a hash collision in the
 * refinement); it is stable within a single build, and the colour prefix makes it
 * isomorphism-stable across builds for the distinguishable cases.
 */
function assignLabels(
  blanks: ReadonlySet<string>,
  colour: ReadonlyMap<string, string>,
): Map<string, string> {
  // Order by final colour, then by the original blank id as a stable tiebreak.
  const ordered = [...blanks].sort(
    (a, b) => compareStrings(colour.get(a) ?? "", colour.get(b) ?? "") || compareStrings(a, b),
  );
  const labels = new Map<string, string>();
  for (let i = 0; i < ordered.length; i++) {
    labels.set(ordered[i] as string, `c14n-${i}`);
  }
  return labels;
}

/** A total, locale-independent string comparator (-1 / 0 / 1) for stable sorting. */
function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** The colour of a term in the current round: ground terms by value, blanks by colour. */
function termColour(term: Term, colour: ReadonlyMap<string, string>): string {
  if (term.termType === "BlankNode") {
    return colour.get(term.value) ?? "_:b";
  }
  return nquadsTerm(term, undefined);
}

/**
 * Serialise a single quad to a canonical N-Quads line. The graph term is emitted
 * when the quad is in a named graph (anything other than the default graph), so
 * two datasets that differ only by named graph serialise — and therefore hash —
 * differently (N-Quads semantics).
 */
function quadToLine(q: Quad, labels: Map<string, string>): string {
  const s = nquadsTerm(q.subject, labels);
  const p = nquadsTerm(q.predicate, labels);
  const o = nquadsTerm(q.object, labels);
  // A DefaultGraph has an empty value; only emit a graph label for a named graph.
  const inDefaultGraph =
    q.graph === undefined || q.graph.termType === "DefaultGraph" || q.graph.value === "";
  if (inDefaultGraph) {
    return `${s} ${p} ${o} .`;
  }
  return `${s} ${p} ${o} ${nquadsTerm(q.graph, labels)} .`;
}

/** Serialise a term to its canonical N-Quads form (blanks via `labels`). */
function nquadsTerm(term: Term, labels: Map<string, string> | undefined): string {
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value}>`;
    case "BlankNode": {
      const label = labels?.get((term as BlankNode).value);
      return `_:${label ?? (term as BlankNode).value}`;
    }
    case "Literal": {
      const lit = term;
      const escaped = escapeLiteral(lit.value);
      if (lit.language) {
        return `"${escaped}"@${lit.language}`;
      }
      const dt = lit.datatype?.value;
      // Per N-Triples, a plain string (xsd:string) needs no explicit datatype;
      // emit the datatype for any other type so the canonical form is exact.
      if (dt && dt !== "http://www.w3.org/2001/XMLSchema#string") {
        return `"${escaped}"^^<${dt}>`;
      }
      return `"${escaped}"`;
    }
    default:
      // Variables / quads are not produced here; serialise defensively.
      return `<${term.value}>`;
  }
}

/** Escape a literal lexical value for N-Triples. */
function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
