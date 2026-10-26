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
