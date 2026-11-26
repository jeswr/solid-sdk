// AUTHORED-BY Claude Opus 5.5
//
// Serialises demo documents through typed accessors instead of hand-built quads.

import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";

class DemoNode extends TermWrapper {
  iris(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
  texts(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, LiteralAs.string, LiteralFrom.string);
  }
}

/** Turtle for the statements `build` adds through `node(iri)`. */
export function demoTurtle(build: (node: (iri: string) => DemoNode) => void): string {
  const store = new Store();
  build((iri) => new DemoNode(iri, store, DataFactory));
  return new Writer().quadsToString([...store]);
}
