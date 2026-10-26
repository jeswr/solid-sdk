// AUTHORED-BY Claude Opus 5.5
import type { Quad, Term } from "@jeswr/fetch-rdf";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, test } from "vitest";
import { createMemoryStorage } from "./memory.js";
import { serializeQuads } from "./rdf.js";

const { namedNode, blankNode, variable, literal, quad, defaultGraph } = DataFactory;
const ROOT = "https://memory.example/";
const URL = `${ROOT}terms.ttl`;
const s = namedNode("urn:s");
const p = namedNode("urn:p");
const SPOOF = "<urn:injected-id> . <urn:injected-id> <urn:p> <urn:injected-id> . #";

/** A foreign RDF/JS object whose private `id` must never reach the writer. */
function foreign<T extends Term>(term: T, overrides: Record<string, unknown> = {}): T {
  return {
    termType: term.termType,
    value: term.value,
    ...(term.termType === "Literal"
      ? {
          language: term.language,
          datatype: foreign(term.datatype),
          direction: (term as { direction?: string }).direction,
        }
      : {}),
    id: SPOOF,
    equals: () => {
      throw new Error("Caller methods must not be read");
    },
    ...overrides,
  } as unknown as T;
}

const expected = [
  quad(blankNode("safe"), p, blankNode("safe")),
  quad(s, p, literal('plain "value"\n')),
  quad(s, p, literal("42", namedNode("http://www.w3.org/2001/XMLSchema#integer"))),
  quad(s, p, literal("bonjour", "fr")),
  quad(s, p, literal("مرحبا", "ar--rtl")),
  quad(s, p, namedNode("urn:o")),
];
const misleading = expected.map((q) =>
  quad(foreign(q.subject), foreign(q.predicate), foreign(q.object), foreign(q.graph)),
);

function expectTurtle(body: string, intended: readonly Quad[] = expected) {
  expect(body).not.toContain("injected-id");
  const parsed = new Parser({ format: "text/turtle", blankNodePrefix: "" }).parse(body);
  expect(parsed).toHaveLength(intended.length);
  const dataset = new Store(parsed);
  for (const q of intended) expect(dataset.has(q)).toBe(true);
}

describe("foreign RDF/JS term serialisation", () => {
  test("serializeQuads ignores misleading ids on every term type", async () => {
    expectTurtle(await serializeQuads(misleading, "text/turtle"));
  });

  test("memory writeRdf stores exactly the supplied RDF fields", async () => {
    const storage = createMemoryStorage({ root: ROOT });
    await storage.writeRdf(URL, misleading, { ifMatch: "*" });
    expectTurtle(await (await storage.read(URL)).text());
  });

  test("RDF/JS 1.1 language literals without direction keep their language", async () => {
    const term = foreign(literal("hello", "en"));
    delete (term as { direction?: string }).direction;
    expectTurtle(await serializeQuads([quad(s, p, term)], "text/turtle"), [
      quad(s, p, literal("hello", "en")),
    ]);
  });

  test("a null direction means no base direction", async () => {
    const term = foreign(literal("hello", "en"), { direction: null });
    expectTurtle(await serializeQuads([quad(s, p, term)], "text/turtle"), [
      quad(s, p, literal("hello", "en")),
    ]);
  });

  test("variables are refused even with a misleading id", async () => {
    const input = [quad(foreign(variable("subject")), p, s)];
    expect(() => serializeQuads(input, "text/turtle")).toThrow(TypeError);
  });
});

const invalidTerms = [
  ...[namedNode("urn:o"), blankNode("safe"), literal("v"), defaultGraph()].map(
    (term) => [`${term.termType}.value`, foreign(term, { value: 1 })] as const,
  ),
  ["Literal.language", foreign(literal("v", "en"), { language: 7 })],
  ["Literal.direction", foreign(literal("v", "en"), { direction: false })],
  ["Literal.direction without language", foreign(literal("v"), { direction: 7 })],
  ["Literal.datatype.value", foreign(literal("v"), { datatype: { value: 9 } })],
  ["Literal without datatype", foreign(literal("v"), { datatype: undefined })],
] as const;

describe("malformed RDF/JS fields", () => {
  test.each(invalidTerms)("rejects non-string %s before writing", async (_name, term) => {
    const q =
      term.termType === "DefaultGraph"
        ? quad(s, p, s, term as Quad["graph"])
        : quad(s, p, term as Quad["object"]);
    expect(() => serializeQuads([q], "text/turtle")).toThrow(TypeError);
    const memory = createMemoryStorage({ root: ROOT });
    await expect(memory.writeRdf(URL, [q], { ifMatch: "*" })).rejects.toThrow(TypeError);
    await expect(memory.head(URL)).rejects.toMatchObject({ code: "not-found" });
  });
});
