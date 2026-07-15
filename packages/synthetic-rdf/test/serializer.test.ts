// AUTHORED-BY GPT-5.6 Sol via codex

import { serialize } from "@jeswr/rdf-serialize";
import { expect, it } from "vitest";
import { generateUnchecked } from "../src/index.js";
import { shapes } from "./helpers.js";

it("keeps canonical output in parity with the sanctioned N3 serializer", async () => {
  const shapeDataset = shapes(`
    ex:PersonShape a sh:NodeShape; sh:targetClass ex:Person;
      sh:property [ sh:path ex:name; sh:hasValue "Fixed" ] .
  `);
  const result = generateUnchecked({ shapes: shapeDataset, seed: "serializer" });
  const prefixes = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    sh: "http://www.w3.org/ns/shacl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  };
  const canonical = [...result.dataset].sort((left, right) => {
    const key = (quad: typeof left) =>
      [quad.subject, quad.predicate, quad.object, quad.graph]
        .map((term) => `${term.termType}:${term.value}`)
        .join("\u0000");
    return key(left).localeCompare(key(right), "en");
  });
  await expect(serialize(canonical, { prefixes })).resolves.toBe(result.toTurtle());
});
