// AUTHORED-BY Codex GPT-6
import { serialize } from "@jeswr/rdf-serialize";
import type { BlankNode } from "@rdfjs/types";
import {
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { buildDriveRootMarker } from "./type-index.js";
import { RDF, SOLID } from "./vocab.js";

/** Typed envelope for a Solid N3 InsertDeletePatch and its formula references. */
class SolidPatch extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF.type, NamedNodeAs.string, NamedNodeFrom.string);
  }

  set where(graph: BlankNode) {
    RequiredAs.object(this, `${SOLID.ns}where`, graph, TermFrom.itself);
  }

  set inserts(graph: BlankNode) {
    RequiredAs.object(this, `${SOLID.ns}inserts`, graph, TermFrom.itself);
  }
}

export async function driveRootPatch(rootUrl: string): Promise<string> {
  const { blankNode, defaultGraph, quad } = DataFactory;
  const where = blankNode("where");
  const inserts = blankNode("inserts");
  const dataset = new Store();
  const patch = new SolidPatch(blankNode("patch"), dataset, DataFactory);
  patch.types.add(`${SOLID.ns}InsertDeletePatch`);
  patch.where = where;
  patch.inserts = inserts;
  // The marker builder owns the inserted triples; only their graph is changed here.
  dataset.addQuads(
    buildDriveRootMarker(rootUrl).map((q) => quad(q.subject, q.predicate, q.object, inserts)),
  );
  // n3.Writer emits labelled graphs as TriG, even with format text/n3. Serialize
  // every triple with Writer (via serialize), then inline the two formula graphs
  // at their fixed blank-node references. No RDF terms or patch triples are text-built.
  let document = await serialize(dataset.getQuads(null, null, null, defaultGraph()));
  for (const graph of [where, inserts]) {
    const formula = await serialize(
      dataset.getQuads(null, null, null, graph).map((q) => quad(q.subject, q.predicate, q.object)),
    );
    document = document.replaceAll(`_:${graph.value}`, () => ["{", formula, "}"].join("\n"));
  }
  return document;
}
