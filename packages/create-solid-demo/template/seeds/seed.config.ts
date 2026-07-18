/**
 * Deterministic seed wiring: SHACL shapes (packages/data-model) → synthetic RDF
 * (@jeswr/synthetic-rdf, independently SHACL-validated) → pod layout
 * (@jeswr/solid-seed). Pure configuration — run.ts owns env + execution.
 */
import { readFileSync } from "node:fs";
import type { PodLayout, SeedTarget } from "@jeswr/solid-seed";
import { generate, type SyntheticRdfResult } from "@jeswr/synthetic-rdf";
import { shaclEngineValidator } from "@jeswr/synthetic-rdf/validate";
import type { DatasetCore } from "@rdfjs/types";
import { Parser, Store } from "n3";
import { personaShapePath } from "@__CSD_SLUG__/data-model";
import { personaOverride, personaShape } from "./persona.ts";

export function loadShapes(): DatasetCore {
  return new Store(new Parser().parse(readFileSync(personaShapePath, "utf8")));
}

/** Same seed, same output — pin `seed` and `now`; never ambient entropy. */
export async function generateSeedData(): Promise<SyntheticRdfResult> {
  return generate({
    now: new Date("2026-01-01T00:00:00Z"),
    overrides: [personaOverride],
    seed: "__CSD_SLUG__-demo-persona",
    shapes: loadShapes(),
    targets: [{ count: 1, shape: personaShape }],
    validator: shaclEngineValidator(),
  });
}

/** The starter layout: the persona card in the data subject's pod (owner-only access). */
export function layoutFor(target: SeedTarget): PodLayout {
  return {
    pods: [
      {
        account: { target },
        resources: [
          {
            contentType: "text/turtle",
            path: "/public/persona.ttl",
            source: { instance: { shape: personaShape.value } },
          },
        ],
      },
    ],
  };
}
