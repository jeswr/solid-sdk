/**
 * Shape gates: every committed shape parses as Turtle, and every named node stays
 * inside real namespaces or urn:example: (the no-minted-IRIs house rule).
 */
import { readFileSync } from "node:fs";
import { Parser } from "n3";
import { expect, test } from "vitest";
import { PERSONA_SHAPE_IRI, personaShapePath } from "../src/index.ts";

const ALLOWED_IRI_PREFIXES = ["https://schema.org/", "http://www.w3.org/", "urn:example:"];

test("persona.ttl parses and declares the persona shape", () => {
  const quads = new Parser().parse(readFileSync(personaShapePath, "utf8"));
  expect(quads.length).toBeGreaterThan(0);
  expect(quads.some((quad) => quad.subject.value === PERSONA_SHAPE_IRI)).toBe(true);
});

test("no minted IRIs: every named node uses a real namespace or urn:example:", () => {
  const quads = new Parser().parse(readFileSync(personaShapePath, "utf8"));
  const named = new Set<string>();
  for (const quad of quads) {
    for (const term of [quad.subject, quad.predicate, quad.object]) {
      if (term.termType === "NamedNode") named.add(term.value);
    }
  }
  const violations = [...named].filter(
    (iri) => !ALLOWED_IRI_PREFIXES.some((prefix) => iri.startsWith(prefix)),
  );
  expect(violations).toEqual([]);
});
