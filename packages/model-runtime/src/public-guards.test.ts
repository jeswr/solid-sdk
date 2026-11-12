// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
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
  it("charges every walk to one shared operation budget and fails closed", () => {
    const chain = Array.from(
      { length: 50 },
      (_, i) => `ex:C${i} rdfs:subClassOf ex:C${i + 1}.`,
    ).join(" ");
    const store = new Store(
      new Parser().parse(
        `@prefix ex: <https://example.org/>. @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>. ex:s a ex:C0. ${chain}`,
      ),
    );
    const doc = new TermWrapper(DataFactory.namedNode("https://example.org/s"), store, DataFactory);
    const top = ["https://example.org/C50"];
    const roomy = { reads: 0, limit: 1000 };
    expect(hasDatasetClass(doc, doc.value, top, roomy)).toBe(true);
    expect(roomy.reads).toBe(51);
    const budget = { reads: 0, limit: 120 };
    expect(hasDatasetClass(doc, doc.value, top, budget)).toBe(true);
    expect(hasDatasetClass(doc, doc.value, top, budget)).toBe(true);
    // The third walk exhausts the shared budget: false, never a thrown MigrationError.
    expect(hasDatasetClass(doc, doc.value, top, budget)).toBe(false);
    expect(hasDatasetClass(doc, doc.value, ["https://example.org/C0"], budget)).toBe(false);
    expect(budget.reads).toBeGreaterThan(budget.limit);
    expect(hasDatasetClass(doc, doc.value, top, { reads: 0, limit: Number.NaN })).toBe(false);
  });
});
