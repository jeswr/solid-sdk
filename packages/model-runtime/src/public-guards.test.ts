// AUTHORED-BY Codex (GPT-6.1 Sol)
import { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { applyScalarGuards, hasDatasetClass, type ManifestField } from "./index.js";

describe("public schema interpreter guards", () => {
  it("exports the existing scalar guards without coercion", () => {
    const field: ManifestField = {
      name: "value",
      predicate: "https://example.org/value",
      kind: "literal",
      datatype: "xsd:integer",
      guards: { minInclusive: 1, maxInclusive: 2 },
    };
    expect(applyScalarGuards(field, 1)).toBe(1);
    expect(applyScalarGuards(field, 0)).toBeUndefined();
    expect(applyScalarGuards(field, NaN)).toBeUndefined();
    expect(applyScalarGuards(field, "1")).toBe("1"); // Datatype checks belong to the mapper.
  });
  it("exports the bounded class walk without migration context", () => {
    const store = new Store(
      new Parser().parse(
        `@prefix ex: <https://example.org/>. @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>. ex:s a ex:Child. ex:Child rdfs:subClassOf ex:Parent,ex:Child.`,
      ),
    );
    const doc = new TermWrapper(DataFactory.namedNode("https://example.org/s"), store, DataFactory);
    expect(hasDatasetClass(doc, doc.value, ["https://example.org/Parent"])).toBe(true);
    expect(hasDatasetClass(doc, doc.value, ["https://example.org/Missing"])).toBe(false);
  });
});
