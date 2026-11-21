// AUTHORED-BY Codex GPT-6.2 Sol
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { readNQuads, writeNQuads } from "../src/wire/store-quads.js";

it("writes a bytewise-sorted, deterministic N-Quads set", () => {
  const { namedNode, literal } = DataFactory;
  const graph = new Store();
  graph.addQuad(namedNode("urn:s"), namedNode("urn:p"), literal("é"), namedNode("urn:g"));
  graph.addQuad(namedNode("urn:s"), namedNode("urn:p"), literal("😀"), namedNode("urn:g"));
  graph.addQuad(namedNode("urn:s"), namedNode("urn:p"), literal(""), namedNode("urn:g"));
  const text = writeNQuads(graph);
  expect(writeNQuads(new Store([...graph].reverse()))).toBe(text);
  const lines = text.trimEnd().split("\n");
  expect(lines).toEqual([...lines].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  const decoded = readNQuads(text);
  expect(decoded.size).toBe(graph.size);
  for (const quad of graph) expect(decoded.has(quad)).toBe(true);
});

it("refuses blank nodes at either store boundary", () => {
  const graph = new Store();
  graph.addQuad(DataFactory.blankNode(), DataFactory.namedNode("urn:p"), DataFactory.literal("a"));
  expect(() => writeNQuads(graph)).toThrow();
  expect(() => readNQuads('_:b <urn:p> "a" .\n')).toThrow();
});

it("refuses a literal that UTF-8 cannot represent losslessly", () => {
  const graph = new Store();
  graph.addQuad(
    DataFactory.namedNode("urn:s"),
    DataFactory.namedNode("urn:p"),
    DataFactory.literal("\udc00"),
  );
  expect(() => writeNQuads(graph)).toThrow("well-formed Unicode");
});
