// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { MemoryItem, parseMemoryTtl, serializeMemory } from "./memory.js";
import { LEGACY_MEMORY_NS, MEM, MEM_EMBEDDING_REF } from "./vocab.js";

const url = "https://alice.example/memories/one.ttl";
// Legacy-read fixture: independent of the current writer's constants and implementation.
const legacyFixture = `@prefix mem: <https://w3id.org/jeswr/memory#> .
@prefix schema: <http://schema.org/> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${url}#it> a mem:MemoryItem ; schema:text "Prefers tea" ;
  schema:keywords "preference" ; schema:about <https://example.org/Preference> ;
  dct:created "2026-07-01T08:00:00.000Z"^^xsd:dateTime ;
  prov:wasGeneratedBy <https://alice.example/chat/room#it> ;
  mem:embeddingRef <https://alice.example/memories/one.embedding> .`;

describe("canonical writes and legacy memory reads", () => {
  it("reads the same memory from legacy and canonical fixtures", async () => {
    const expected = {
      text: "Prefers tea",
      keywords: ["preference"],
      categories: ["https://example.org/Preference"],
      created: new Date("2026-07-01T08:00:00Z"),
      generatedBy: "https://alice.example/chat/room#it",
      embeddingRef: "https://alice.example/memories/one.embedding",
    };
    expect(await parseMemoryTtl(url, legacyFixture)).toEqual(expected);
    expect(await parseMemoryTtl(url, legacyFixture.replaceAll(LEGACY_MEMORY_NS, MEM))).toEqual(
      expected,
    );
    const written = await serializeMemory(url, expected);
    expect(written).toContain("https://jeswr.org/ns/memory#");
    expect(written).not.toContain(LEGACY_MEMORY_NS);
  });

  it("accepts mixed namespace types and predicates through direct typed accessors", async () => {
    const dataset = await parseRdf(
      legacyFixture.replace("mem:MemoryItem", `<${MEM}MemoryItem>`),
      "text/turtle",
    );
    const memory = new MemoryItem(`${url}#it`, dataset, DataFactory);
    expect(memory.isMemory).toBe(true);
    expect(memory.embeddingRef).toBe("https://alice.example/memories/one.embedding");
    memory.embeddingRef = "https://alice.example/new.embedding";
    expect(memory.embeddingRef).toBe("https://alice.example/new.embedding");
    expect(
      dataset.match(
        DataFactory.namedNode(memory.id),
        DataFactory.namedNode(`${LEGACY_MEMORY_NS}embeddingRef`),
      ).size,
    ).toBe(0);
    expect(
      dataset.match(DataFactory.namedNode(memory.id), DataFactory.namedNode(MEM_EMBEDDING_REF))
        .size,
    ).toBe(1);
  });
});
