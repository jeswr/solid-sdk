// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { afterAll, describe, expect, it } from "vitest";
import { buildMemory, type MemoryData, serializeMemory } from "./memory.js";

const engine = createRdfEngine();
afterAll(() => engine.dispose());

// Test-only projection of MemoryData's existing required string body. This
// package has no published SHACL artifact; no new public shape is introduced.
const shapes = `
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
  <urn:test:MemoryShape> a sh:NodeShape ;
    sh:targetClass <https://w3id.org/jeswr/memory#MemoryItem> ;
    sh:property [ sh:path <http://schema.org/text> ;
      sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ] .
`;
const url = "https://alice.example/memories/one";

describe("memory SHACL validation with real Node WASM", () => {
  it("accepts the minimal builder output", async () => {
    const report = await engine.validate(buildMemory(url, { text: "Remember this" }), shapes);
    expect(report).toMatchObject({ conforms: true, results: [] });
  });

  it("accepts all existing optional fields after serialization", async () => {
    const data: MemoryData = {
      text: "Alice prefers dark mode",
      created: new Date("2026-06-01T10:00:00Z"),
      modified: new Date("2026-06-02T10:00:00Z"),
      keywords: ["preference", "ui"],
      categories: ["https://example.org/Preference"],
      about: "https://example.org/dark-mode",
      attributedTo: "https://agent.example/profile#me",
      generatedBy: "https://alice.example/chat/one#it",
      embeddingRef: "https://alice.example/memories/one.embedding",
      invalidatedAt: new Date("2026-06-03T10:00:00Z"),
    };
    const dataset = await parseRdf(await serializeMemory(url, data), "text/turtle", { engine });
    expect((await engine.validate(dataset, shapes)).conforms).toBe(true);
  });

  it.each([
    ["missing", ""],
    ["IRI", "<http://schema.org/text> <https://example.org/body> ;"],
    ["multiple", '<http://schema.org/text> "first", "second" ;'],
  ])("rejects a %s body", async (_name, body) => {
    const dataset = await parseRdf(
      `<${url}#it> ${body} a <https://w3id.org/jeswr/memory#MemoryItem> .`,
      "text/turtle",
    );
    const report = await engine.validate(dataset, shapes);
    expect(report.conforms).toBe(false);
    expect(report.results.some((result) => result.path === "<http://schema.org/text>")).toBe(true);
  });
});
