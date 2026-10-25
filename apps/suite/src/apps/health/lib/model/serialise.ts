// AUTHORED-BY Codex GPT-6.1-Sol — ported from apps/pod-health/src/serialise.ts
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Serialisation — turn an in-memory dataset (the HealthDocument / any
// DatasetCore) into Turtle for a conditional PUT back to the pod. Uses
// n3.Writer with the project prefixes; never hand-concatenates Turtle.

import { safeIri, serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { DataFactory } from "n3";
import { canonicalizeHealthDataset } from "./canonical-vocab.js";
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
export async function toTurtle(dataset: DatasetCore): Promise<string> {
  try {
    const quads = [...canonicalizeHealthDataset(dataset, DataFactory)] as Quad[];
    for (const quad of quads) {
      if (quad.graph.termType !== "DefaultGraph")
        throw new TypeError("Turtle serialization requires the default graph");
      for (const term of [
        quad.subject,
        quad.predicate,
        quad.object,
        quad.object.termType === "Literal" ? quad.object.datatype : undefined,
      ]) {
        if (term?.termType === "NamedNode" && safeIri(term.value) !== term.value)
          throw new TypeError("Unsafe RDF IRI");
      }
    }
    return await serialize(quads, { prefixes: PREFIXES, emptyAsEmptyString: false });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
