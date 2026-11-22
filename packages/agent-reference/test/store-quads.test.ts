// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { DataFactory, Store } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import {
  readLocalStoreFile,
  readLocalStoreRdf,
  readNQuads,
  writeNQuads,
} from "../src/wire/store-quads.js";

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

it("bounds prefix expansion in local Turtle stores", () => {
  const prefix = `@prefix long: <urn:${"a".repeat(128 * 1024)}:> .\n`;
  expect(readLocalStoreRdf(`${prefix} <urn:s> <urn:p> long:ok .`, "text/turtle").size).toBe(1);
  const objects = Array.from({ length: 1_025 }, (_, index) => `long:n${index}`).join(", ");
  let failure: unknown;
  try {
    readLocalStoreRdf(`${prefix} <urn:s> <urn:p> ${objects} .\n!`, "text/turtle");
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    cause: { message: expect.stringContaining("maxTotalTermLength") },
  });
});

it.each([
  ["application/n-quads", 1_000_000],
  ["text/turtle", 250_000],
] as const)("enforces the %s quad limit before lexing the whole file", (format, limit) => {
  const directory = mkdtempSync(join(tmpdir(), "awp-local-rdf-"));
  const path = join(directory, "store");
  // Repeated quads count toward the parse budget even though the RDF set deduplicates them.
  // A lexer that scans the entire input first would report the invalid tail instead.
  const statement = "<a:s> <a:p> <a:o> .\n";
  try {
    writeFileSync(path, `${statement.repeat(limit + 1)}!`);
    const input = readLocalStoreFile(path, format);
    expect(() => readLocalStoreRdf(input, format)).toThrow(
      expect.objectContaining({
        code: "PARSE_LIMIT",
        cause: expect.objectContaining({ message: expect.stringContaining("maxQuads") }),
      }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("refuses invalid UTF-8 in local store files", () => {
  const directory = mkdtempSync(join(tmpdir(), "awp-local-rdf-"));
  const path = join(directory, "store");
  const format = "application/n-quads";
  try {
    const start = '<urn:example:subject> <urn:example:predicate> "';
    const end = '" .\n';
    writeFileSync(path, `${start}\ufffd${end}`);
    expect(readLocalStoreRdf(readLocalStoreFile(path, format), format).size).toBe(1);
    writeFileSync(path, Buffer.concat([Buffer.from(start), Buffer.of(0xff), Buffer.from(end)]));
    expect(() => readLocalStoreFile(path, format)).toThrow(
      expect.objectContaining({ code: "ERR_ENCODING_INVALID_ENCODED_DATA" }),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
