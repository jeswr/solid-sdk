// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Serialisation — turn an in-memory dataset (the HealthDocument / any
// DatasetCore) into Turtle for a conditional PUT back to the pod. Uses
// n3.Writer with the project prefixes; never hand-concatenates Turtle.

import type { DatasetCore, Quad } from "@rdfjs/types";
import { Writer } from "n3";
import { CORE, DCTERMS, GEO, HEALTH, PH, RDF, SOLID, TIME, UNIT, XSD } from "./vocab.js";

/** The prefixes n3.Writer emits at the head of serialised Turtle. */
export const PREFIXES: Readonly<Record<string, string>> = {
  rdf: RDF,
  xsd: XSD,
  dcterms: DCTERMS,
  health: HEALTH,
  core: CORE,
  time: TIME,
  unit: UNIT,
  geo: GEO,
  ph: PH,
  solid: SOLID,
};

/**
 * Serialise a dataset to Turtle, returned as a Promise<string>. Wraps the
 * callback-style n3.Writer so callers get a single awaitable string suitable for
 * a `PUT`/`PATCH` body.
 */
export function toTurtle(dataset: DatasetCore): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = (error: unknown): void => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const writer = new Writer({ prefixes: { ...PREFIXES } });
    try {
      for (const quad of dataset as Iterable<Quad>) {
        writer.addQuad(quad);
      }
      // n3.Writer's `end` callback yields the serialised Turtle, or an error if
      // the underlying write failed; both route through `fail`/`resolve`.
      writer.end((error: Error | null | undefined, result: string) =>
        error ? fail(error) : resolve(result),
      );
    } catch (error) {
      // A malformed dataset (an iterator/term that throws) surfaces here.
      fail(error);
    }
  });
}
