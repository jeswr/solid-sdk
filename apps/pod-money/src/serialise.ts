// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Serialisation — turn an in-memory dataset (mutated through the typed
// accessors) into Turtle for a conditional PUT, using n3.Writer.
//
// House rule: serialise via n3.Writer — NEVER hand-concatenate Turtle.

import type { DatasetCore, Quad } from "@rdfjs/types";
import { DataFactory, Writer } from "n3";
import { CORE, DCTERMS, FIN, PIM, PM, RDF, SKOS, SOLID, XSD } from "./vocab.js";

/** Stable prefix map applied to every document Pod Money writes. */
export const PREFIXES: Readonly<Record<string, string>> = {
  fin: FIN,
  core: CORE,
  pm: PM,
  solid: SOLID,
  pim: PIM,
  rdf: RDF,
  dcterms: DCTERMS,
  skos: SKOS,
  xsd: XSD,
};

/**
 * Serialise a dataset to Turtle. Deterministic prefixes; quads are written in
 * the dataset's iteration order. Resolves to a Turtle string suitable for a
 * `PUT` with `content-type: text/turtle`.
 */
export function serialiseTurtle(dataset: DatasetCore): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const writer = new Writer({ prefixes: { ...PREFIXES } });
      for (const quad of dataset as Iterable<Quad>) {
        writer.addQuad(quad);
      }
      writer.end((error: Error | null, result: string) => {
        if (error) reject(error);
        else resolve(result);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** The shared `DataFactory` — one factory everywhere so term equality holds. */
export { DataFactory };
