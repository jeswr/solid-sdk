/**
 * The demo persona fixture. KEEP IN SYNC with `walkthrough.persona` in
 * apps/tour/content/walkthrough.json — the seeded pod data must match the card
 * the tour renders. Everything is deterministic: same seed, same output.
 */
import type { ShapeOverride } from "@jeswr/synthetic-rdf";
import { DataFactory } from "n3";
import { PERSONA_SHAPE_IRI, SCHEMA_ORG } from "@__CSD_SLUG__/data-model";

const { literal, namedNode } = DataFactory;

export const personaShape = namedNode(PERSONA_SHAPE_IRI);

/** Matches walkthrough.persona.name / the "Identifier" field. */
export const personaName = "Alex Sample";
export const personaIdentifier = "AS-0001";

/** Exact persona pins (an override REPLACES the property's full value set). */
export const personaOverride: ShapeOverride = {
  id: { fragment: "persona" },
  index: 0,
  shape: personaShape,
  values: {
    [`${SCHEMA_ORG}identifier`]: literal(personaIdentifier),
    [`${SCHEMA_ORG}name`]: literal(personaName),
  },
};
