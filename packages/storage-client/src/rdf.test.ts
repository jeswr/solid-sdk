// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
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
  test("JSON-LD reads foreign term fields without using private ids or methods", async () => {
    const input = misleading.filter((q) => !(q.object as { direction?: string }).direction);
    const body = await serializeQuads(input, "application/ld+json");
    expect(body).not.toContain("injected-id");
    expect(JSON.parse(body)).toEqual([
      { "@id": "_:b0", "urn:p": [{ "@id": "_:b0" }] },
      {
        "@id": "urn:s",
        "urn:p": [
          { "@value": 'plain "value"\n' },
          { "@value": "42", "@type": "http://www.w3.org/2001/XMLSchema#integer" },
          { "@value": "bonjour", "@language": "fr" },
          { "@id": "urn:o" },
        ],
      },
    ]);
  });

  test.each([
    foreign(literal("v"), { language: "en" }),
    foreign(literal("v", "en"), { language: "" }),
    foreign(literal("v"), { direction: "rtl" }),
  ])("JSON-LD rejects inconsistent literal fields before n3 can discard them: %j", async (term) => {
    const storage = createMemoryStorage({ root: ROOT });
    await expect(
      storage.writeRdf(URL, [quad(s, p, term)], {
        ifMatch: "*",
        contentType: "application/ld+json",
      }),
    ).rejects.toThrow(TypeError);
    await expect(storage.head(URL)).rejects.toMatchObject({ code: "not-found" });
  });

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
  ["unknown termType", foreign(namedNode("urn:o"), { termType: "Bogus" })],
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

/** An n3 instance whose public `value` disagrees with the private id n3.Store would match on. */
function disguised(id: string, value: string): Quad["object"] {
  const term = namedNode(id);
  Object.defineProperty(term, "value", { value });
  return term;
}

describe.each(["solid", "lws"] as const)("memory %s RDF patch term identity", (protocol) => {
  async function seeded() {
    const storage = createMemoryStorage({ protocol, root: ROOT });
    const url =
      protocol === "solid"
        ? URL
        : (await storage.create(ROOT, "", { contentType: "text/turtle" })).url;
    const etag =
      protocol === "solid"
        ? (await storage.writeRdf(url, [quad(s, p, namedNode("urn:victim"))], { ifMatch: "*" }))
            .etag
        : (
            await storage.writeRdf(url, [quad(s, p, namedNode("urn:victim"))], {
              ifMatch: (await storage.head(url)).etag as string,
            })
          ).etag;
    return { storage, url, etag: etag as string };
  }

  test("deletions match the RDF/JS value, never n3's private id", async () => {
    const { storage, url, etag } = await seeded();
    const before = await (await storage.read(url)).text();
    await expect(
      storage.patch(
        url,
        { kind: "rdf", inserts: [], deletes: [quad(s, p, disguised("urn:victim", "urn:absent"))] },
        { ifMatch: etag },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await (await storage.read(url)).text()).toBe(before);
    expect((await storage.head(url)).etag).toBe(etag);
  });

  test("insertions store the RDF/JS value, never n3's private id", async () => {
    const { storage, url, etag } = await seeded();
    await storage.patch(
      url,
      { kind: "rdf", inserts: [quad(s, p, disguised("urn:id", "urn:intended"))], deletes: [] },
      { ifMatch: etag },
    );
    const text = await (await storage.read(url)).text();
    expect(text).toContain("urn:intended");
    expect(text).not.toContain("urn:id");
  });

  test.each(invalidTerms)("refuses a non-string %s in a patch", async (_name, term) => {
    const { storage, url, etag } = await seeded();
    const before = await (await storage.read(url)).text();
    const q =
      term.termType === "DefaultGraph"
        ? quad(s, p, s, term as Quad["graph"])
        : quad(s, p, term as Quad["object"]);
    await expect(
      storage.patch(url, { kind: "rdf", inserts: [q], deletes: [] }, { ifMatch: etag }),
    ).rejects.toMatchObject({ code: "bad-request" });
    expect(await (await storage.read(url)).text()).toBe(before);
    expect((await storage.head(url)).etag).toBe(etag);
  });
});

describe("terms n3 cannot encode faithfully", () => {
  const quoted = 'urn:d"@en . <urn:forged> <urn:p> <urn:o> . #';
  const quotedLiteral = () =>
    ({
      termType: "Literal",
      value: "intended",
      language: "",
      datatype: { termType: "NamedNode", value: quoted },
    }) as unknown as Quad["object"];

  test("a quote in a datatype IRI is escaped, never read as a language tag", async () => {
    const body = await serializeQuads([quad(s, p, quotedLiteral())], "text/turtle");
    const parsed = new Parser({ format: "text/turtle" }).parse(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.object.value).toBe("intended");
    expect(body).not.toContain("<urn:forged>");
  });

  test.each([
    "solid",
    "lws",
  ] as const)("%s patch inserts escape quoted datatypes", async (protocol) => {
    const storage = createMemoryStorage({ protocol, root: ROOT });
    const created =
      protocol === "solid"
        ? await storage.writeRdf(URL, [], { ifMatch: "*" })
        : await storage.create(ROOT, "", { contentType: "text/turtle" });
    await storage.patch(
      created.url,
      { kind: "rdf", inserts: [quad(s, p, quotedLiteral())], deletes: [] },
      { ifMatch: created.etag as string },
    );
    const dataset = (await storage.readRdf(created.url)).dataset;
    expect(dataset.size).toBe(1);
    expect([...dataset][0]?.object.value).toBe("intended");
  });

  test.each([
    "_:b0",
    "?x",
    '"lit"',
    "relative/path",
    "",
  ])("a named node %j that is not an absolute IRI is refused", async (value) => {
    const term = foreign(namedNode("urn:o"), { value });
    expect(() => serializeQuads([quad(s, p, term)], "text/turtle")).toThrow(TypeError);
    const storage = createMemoryStorage({ root: ROOT });
    const created = await storage.writeRdf(URL, [], { ifMatch: "*" });
    await expect(
      storage.patch(
        URL,
        { kind: "rdf", inserts: [quad(s, p, term)], deletes: [] },
        { ifMatch: created.etag as string },
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
    expect((await storage.head(URL)).etag).toBe(created.etag);
  });

  test("one empty blank-node label is one node, distinct from other labels", async () => {
    const empty = { termType: "BlankNode", value: "" } as unknown as Quad["subject"];
    const other = blankNode("empty0");
    const input = [quad(empty, p, empty as Quad["object"]), quad(other, p, s)];
    const body = await serializeQuads(input, "text/turtle");
    const parsed = new Parser({ format: "text/turtle" }).parse(body);
    expect(parsed).toHaveLength(2);
    const loop = parsed.find((q) => q.object.termType === "BlankNode");
    expect(loop?.subject.equals(loop.object)).toBe(true);
    const edge = parsed.find((q) => q.object.termType === "NamedNode");
    expect(edge?.subject.equals(loop?.subject as Term)).toBe(false);

    const storage = createMemoryStorage({ root: ROOT });
    const created = await storage.writeRdf(URL, [], { ifMatch: "*" });
    await storage.patch(
      URL,
      { kind: "rdf", inserts: input, deletes: [] },
      { ifMatch: created.etag as string },
    );
    const stored = [...(await storage.readRdf(URL)).dataset];
    const storedLoop = stored.find((q) => q.object.termType === "BlankNode");
    expect(storedLoop?.subject.equals(storedLoop.object)).toBe(true);
    expect(stored).toHaveLength(2);
  });
});
