// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad, Term } from "@jeswr/fetch-rdf";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { createMemoryStorage } from "./memory.js";
import { injectionSafe, serializeQuads } from "./rdf.js";
import { buildN3Patch, createSolidBackend } from "./solid.js";

const { namedNode, blankNode, variable, literal, quad, defaultGraph } = DataFactory;
const ROOT = "https://memory.example/";
const URL = `${ROOT}terms.ttl`;
const s = namedNode("urn:s");
const p = namedNode("urn:p");
const SPOOF = "<urn:injected-id> . <urn:injected-id> <urn:p> <urn:injected-id> . #";

/** A foreign RDF/JS object whose private representation must never reach the writer. */
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

function expectQuads(actual: Quad[], intended: readonly Quad[]) {
  expect(actual).toHaveLength(intended.length);
  const dataset = new Store(actual);
  for (const q of intended) expect(dataset.has(q)).toBe(true);
}

function expectTurtle(body: string, intended = expected) {
  expect(body).not.toContain("injected-id");
  expectQuads(new Parser({ format: "text/turtle", blankNodePrefix: "" }).parse(body), intended);
}

function expectPatch(
  body: string,
  intended: {
    where?: readonly Quad[];
    deletes?: readonly Quad[];
    inserts: readonly Quad[];
  },
) {
  expect(body).not.toContain("injected-id");
  const parsed = new Parser({ format: "text/n3", blankNodePrefix: "" }).parse(body);
  const envelope = parsed.filter((q) => q.graph.termType === "DefaultGraph");
  let count = envelope.length;
  expect(envelope).toHaveLength(1 + Object.keys(intended).length);
  for (const [name, quads] of Object.entries(intended)) {
    const link = envelope.find(
      (q) => q.predicate.value === `http://www.w3.org/ns/solid/terms#${name}`,
    );
    expect(link).toBeDefined();
    const formula = parsed.filter((q) => q.graph.equals(link?.object));
    count += formula.length;
    // The N3 parser scopes blank labels to their formula; compare the original local labels.
    const local = (term: Term, graph: Term) =>
      term.termType === "BlankNode" ? blankNode(term.value.slice(graph.value.length + 1)) : term;
    expectQuads(
      formula.map((q) =>
        quad(
          local(q.subject, q.graph) as Quad["subject"],
          q.predicate,
          local(q.object, q.graph) as Quad["object"],
        ),
      ),
      quads,
    );
  }
  expect(parsed).toHaveLength(count);
}

describe("foreign RDF/JS term serialization", () => {
  test("serializeQuads ignores misleading ids on every concrete term type", async () => {
    expectTurtle(await serializeQuads(misleading, "text/turtle"));
  });

  test("memory writeRdf stores exactly the supplied RDF fields", async () => {
    const storage = createMemoryStorage({ root: ROOT });
    await storage.writeRdf(URL, misleading, { ifMatch: "*" });
    expectTurtle(await (await storage.read(URL)).text());
  });

  test("Solid writeRdf sends exactly the supplied RDF fields", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expectTurtle(init?.body as string);
      return new Response(null, { status: 204, headers: { etag: '"written"' } });
    });
    await createSolidBackend({ root: ROOT, fetch }).writeRdf(URL, misleading, { ifMatch: "*" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("buildN3Patch ignores ids in inserts, deletes and where", async () => {
    const pattern = quad(variable("subject"), variable("predicate"), variable("value"));
    const spoofedPattern = quad(
      foreign(pattern.subject),
      foreign(pattern.predicate),
      foreign(pattern.object),
      foreign(defaultGraph()),
    );
    const ground = expected.slice(1);
    const input = {
      inserts: [...misleading, spoofedPattern],
      deletes: [...misleading.slice(1), spoofedPattern],
      where: [spoofedPattern],
    };
    expectPatch(await buildN3Patch(input), {
      inserts: [...expected, pattern],
      deletes: [...ground, pattern],
      where: [pattern],
    });
  });

  test("plain RDF/JS variables without ids remain variables in every formula position", async () => {
    const plain = (name: string) => ({
      termType: "Variable" as const,
      value: name,
      equals: () => false,
    });
    const pattern = quad(plain("subject"), plain("predicate"), plain("value"));
    const body = await buildN3Patch({ inserts: [pattern], deletes: [pattern], where: [pattern] });
    expect(body.match(/\?subject \?predicate \?value \.\n/g)).toHaveLength(3);
    const intended = [quad(variable("subject"), variable("predicate"), variable("value"))];
    expectPatch(body, { inserts: intended, deletes: intended, where: intended });
  });

  test("RDF/JS 1.1 language literals without direction preserve their language", async () => {
    const term = foreign(literal("hello", "en"));
    delete (term as { direction?: string }).direction;
    const input = [quad(s, p, term)];
    const intended = [quad(s, p, literal("hello", "en"))];
    expectTurtle(await serializeQuads(input, "text/turtle"), intended);
    expectPatch(await buildN3Patch({ inserts: input, deletes: [] }), { inserts: intended });
  });

  test("a null direction means no base direction", async () => {
    const term = foreign(literal("hello", "en"), { direction: null });
    const intended = [quad(s, p, literal("hello", "en"))];
    expectTurtle(await serializeQuads([quad(s, p, term)], "text/turtle"), intended);
  });

  test("writeRdf refuses foreign variables even with a misleading id", async () => {
    const input = [quad(foreign(variable("subject")), p, s)];
    expect(() => serializeQuads(input, "text/turtle")).toThrow(TypeError);
    const memory = createMemoryStorage({ root: ROOT });
    await expect(memory.writeRdf(URL, input, { ifMatch: "*" })).rejects.toThrow(TypeError);
    const fetch = vi.fn<typeof globalThis.fetch>();
    const solid = createSolidBackend({ root: ROOT, fetch });
    await expect(solid.writeRdf(URL, input, { ifMatch: "*" })).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("every term is rebuilt and unrelated getters are ignored", () => {
    const input = [...expected, quad(variable("x"), p, s)].map((q) =>
      quad(foreign(q.subject), foreign(q.predicate), foreign(q.object), foreign(q.graph)),
    );
    for (const q of input) {
      for (const term of [q.subject, q.predicate, q.object, q.graph]) {
        Object.defineProperty(term, "id", {
          get: () => {
            throw new Error("id was read");
          },
        });
      }
    }
    const safe = injectionSafe(input, true);
    for (const [index, q] of safe.entries()) {
      for (const position of ["subject", "predicate", "object", "graph"] as const) {
        expect(q[position] === input[index]?.[position]).toBe(false);
      }
    }
  });
});

const invalidTerms = [
  ...[namedNode("urn:o"), blankNode("safe"), variable("x"), literal("v"), defaultGraph()].map(
    (term) => [`${term.termType}.value`, foreign(term, { value: 1 })] as const,
  ),
  ["Literal.language", foreign(literal("v", "en"), { language: 7 })],
  ["Literal.direction", foreign(literal("v", "en"), { direction: false })],
  ["Literal.direction without language", foreign(literal("v"), { direction: 7 })],
  ["Literal.datatype.value", foreign(literal("v"), { datatype: { value: 9 } })],
  ["language Literal.datatype.value", foreign(literal("v", "en"), { datatype: { value: null } })],
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
    const fetch = vi.fn<typeof globalThis.fetch>();
    const solid = createSolidBackend({ root: ROOT, fetch });
    await expect(solid.writeRdf(URL, [q], { ifMatch: "*" })).rejects.toThrow(TypeError);
    const patch = { inserts: [q], deletes: [], where: [q] };
    await expect(buildN3Patch(patch)).rejects.toMatchObject({
      code: "bad-request",
      status: null,
      cause: expect.any(TypeError),
    });
    await expect(
      solid.patch(URL, { kind: "rdf", ...patch }, { ifMatch: '"old"' }),
    ).rejects.toMatchObject({
      code: "bad-request",
      status: null,
      cause: expect.any(TypeError),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
