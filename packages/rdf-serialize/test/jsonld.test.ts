// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { legacySerialize, serialize } from "../src/index.js";

const { namedNode, blankNode, literal, quad, defaultGraph, variable } = DataFactory;
const FORMAT = "application/ld+json";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const s = namedNode("https://example.org/日本語/😀");
const p = namedNode("urn:p");

function rawQuad(overrides: Record<string, unknown>): Quad {
  return {
    subject: s,
    predicate: p,
    object: literal("v"),
    graph: defaultGraph(),
    ...overrides,
  } as unknown as Quad;
}

function rawLiteral(overrides: Record<string, unknown>): Term {
  return {
    termType: "Literal",
    value: "v",
    language: "",
    datatype: namedNode(`${XSD}string`),
    ...overrides,
  } as unknown as Term;
}

/** Compare datasets modulo blank-node identifiers, independent of parser ordering. */
function expectIsomorphic(actual: Quad[], expected: Quad[]) {
  const blanks = (quads: Quad[]) =>
    [...new Set(quads.flatMap((q) => [q.subject, q.object, q.graph]))]
      .filter((t) => t.termType === "BlankNode")
      .map((t) => t.value)
      .filter((label, index, labels) => labels.indexOf(label) === index);
  const encode = (quads: Quad[], labels: Map<string, string>) =>
    quads
      .map((q) =>
        JSON.stringify(
          [q.subject, q.predicate, q.object, q.graph].map((t) => [
            t.termType,
            t.termType === "BlankNode" ? labels.get(t.value) : t.value,
            ...(t.termType === "Literal" ? [t.language, t.datatype.value] : []),
          ]),
        ),
      )
      .sort();
  const from = blanks(actual);
  const to = blanks(expected);
  expect(from).toHaveLength(to.length);
  const target = JSON.stringify(encode(expected, new Map(to.map((id) => [id, id]))));
  const matches = (remaining: string[], labels: Map<string, string>): boolean => {
    const id = from[labels.size];
    if (id === undefined) return JSON.stringify(encode(actual, labels)) === target;
    return remaining.some((candidate) =>
      matches(
        remaining.filter((value) => value !== candidate),
        new Map([...labels, [id, candidate]]),
      ),
    );
  };
  expect(matches(to, new Map())).toBe(true);
}

describe("expanded, context-free JSON-LD", () => {
  it("matches a hand-checked fixture and round-trips graphs, shared blanks and list triples", async () => {
    // Input labels deliberately collide with the writer's generated labels.
    const head = blankNode("b1");
    const tail = blankNode("b0");
    const graph = blankNode('unsafe . @context "');
    const namedGraph = namedNode("urn:graph");
    const first = namedNode(`${RDF}first`);
    const rest = namedNode(`${RDF}rest`);
    const input = [
      quad(s, namedNode(`${RDF}type`), namedNode("urn:Class")),
      quad(s, namedNode(`${RDF}type`), namedNode("urn:OtherClass")),
      quad(s, p, literal("https://example.org/is-a-literal")),
      quad(s, p, literal('日本語 😀 " \\ \n\r\t\u0000 @context')),
      quad(s, p, literal("bonjour", "fr-CA")),
      quad(s, p, literal("00042", namedNode(`${XSD}integer`))),
      quad(s, p, literal("1", namedNode(`${XSD}boolean`))),
      quad(s, p, literal("2.00", namedNode(`${XSD}double`))),
      quad(s, p, literal("opaque", namedNode("urn:datatype"))),
      quad(s, namedNode("urn:list"), head),
      quad(head, first, literal("first")),
      quad(head, rest, tail),
      quad(tail, first, namedNode("urn:last")),
      quad(tail, rest, namedNode(`${RDF}nil`)),
      quad(namedGraph, p, literal("graph metadata")),
      quad(s, p, head, namedGraph),
      quad(head, p, literal("inside"), namedGraph),
      quad(s, p, tail, graph),
      quad(s, namedNode(`${RDF}type`), head),
    ];
    const body = await serialize(input, { format: FORMAT, prefixes: { ignored: "urn:" } });
    expect(JSON.parse(body)).toEqual([
      {
        "@id": s.value,
        "@type": ["urn:Class", "urn:OtherClass"],
        "urn:p": [
          { "@value": "https://example.org/is-a-literal" },
          { "@value": '日本語 😀 " \\ \n\r\t\u0000 @context' },
          { "@value": "bonjour", "@language": "fr-ca" },
          { "@value": "00042", "@type": `${XSD}integer` },
          { "@value": "1", "@type": `${XSD}boolean` },
          { "@value": "2.00", "@type": `${XSD}double` },
          { "@value": "opaque", "@type": "urn:datatype" },
        ],
        "urn:list": [{ "@id": "_:b0" }],
        [`${RDF}type`]: [{ "@id": "_:b0" }],
      },
      {
        "@id": "_:b0",
        [`${RDF}first`]: [{ "@value": "first" }],
        [`${RDF}rest`]: [{ "@id": "_:b1" }],
      },
      {
        "@id": "_:b1",
        [`${RDF}first`]: [{ "@id": "urn:last" }],
        [`${RDF}rest`]: [{ "@id": `${RDF}nil` }],
      },
      {
        "@id": "urn:graph",
        "urn:p": [{ "@value": "graph metadata" }],
        "@graph": [
          { "@id": s.value, "urn:p": [{ "@id": "_:b0" }] },
          { "@id": "_:b0", "urn:p": [{ "@value": "inside" }] },
        ],
      },
      {
        "@id": "_:b2",
        "@graph": [{ "@id": s.value, "urn:p": [{ "@id": "_:b1" }] }],
      },
    ]);
    expect(body).not.toContain('"@context":');
    expect(await serialize(input, { format: FORMAT })).toBe(body);
    // parseRdf refuses remote contexts by default; no network loader is provided.
    expectIsomorphic([...(await parseRdf(body, FORMAT))], input);
  });

  it.each([
    undefined,
    true,
    false,
  ])("writes an empty array with emptyAsEmptyString=%s", async (flag) => {
    const options = { format: FORMAT, ...(flag === undefined ? {} : { emptyAsEmptyString: flag }) };
    expect(await serialize([], options)).toBe("[]");
    expect(await parseRdf(await serialize([], options), FORMAT)).toHaveProperty("size", 0);
  });

  it("supports the legacy API and keeps documents independent", async () => {
    const input = [quad(blankNode("arbitrary"), p, blankNode("arbitrary"))];
    expect(await legacySerialize(input, FORMAT)).toBe('[{"@id":"_:b0","urn:p":[{"@id":"_:b0"}]}]');
    await serialize([quad(blankNode("other"), p, s)], { format: FORMAT });
    expect(await legacySerialize(input, FORMAT)).toBe(await serialize(input, { format: FORMAT }));
  });

  it("reads only RDF/JS fields, ignoring caller ids, methods and context options", async () => {
    const trap = vi.fn(() => {
      throw new Error("Caller method used");
    });
    const foreign = (term: Term): Term =>
      ({
        termType: term.termType,
        value: term.value,
        ...(term.termType === "Literal"
          ? {
              language: term.language,
              datatype: { termType: "NamedNode", value: term.datatype.value },
            }
          : {}),
        toJSON: trap,
        equals: trap,
        get id() {
          return trap();
        },
      }) as Term;
    const input = [
      rawQuad({
        subject: foreign(s),
        predicate: foreign(p),
        object: foreign(literal("v")),
        graph: foreign(defaultGraph()),
      }),
    ];
    const options = {
      format: FORMAT,
      get context() {
        return trap();
      },
      get prefixes() {
        return trap();
      },
    };
    const body = await serialize(input, options);
    expect(JSON.parse(body)).toEqual([{ "@id": s.value, "urn:p": [{ "@value": "v" }] }]);
    expect(trap).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    "",
  ])("accepts a non-directional language literal (%s)", async (direction) => {
    const object = rawLiteral({
      language: "EN",
      datatype: namedNode(`${RDF}langString`),
      direction,
    });
    expect(JSON.parse(await serialize([rawQuad({ object })], { format: FORMAT }))).toEqual([
      { "@id": s.value, "urn:p": [{ "@value": "v", "@language": "en" }] },
    ]);
  });

  it("uses one relabelled id for an empty label, even as graph name and subject", async () => {
    const blank = { termType: "BlankNode", value: "" };
    const input = [rawQuad({ subject: blank, object: blank, graph: blank })];
    expect(JSON.parse(await serialize(input, { format: FORMAT }))).toEqual([
      { "@id": "_:b0", "@graph": [{ "@id": "_:b0", "urn:p": [{ "@id": "_:b0" }] }] },
    ]);
    expectIsomorphic(
      [...(await parseRdf(await serialize(input, { format: FORMAT }), FORMAT))],
      input,
    );
  });
});

describe("JSON-LD refuses malformed or unrepresentable RDF without losing data", () => {
  const invalid: [string, Record<string, unknown>][] = [
    ...["subject", "object", "graph"]
      .flatMap((position) =>
        [literal("bad"), variable("x"), defaultGraph(), { termType: "Bogus", value: "v" }]
          .filter((term) => position !== "graph" || term.termType !== "DefaultGraph")
          .map((term): [string, Record<string, unknown>] => [
            `${position}: ${term.termType}`,
            { [position]: term },
          ]),
      )
      .filter(([name]) => name !== "object: Literal"),
    ["blank predicate", { predicate: blankNode("p") }],
    ["literal predicate", { predicate: literal("p") }],
    ["non-empty default graph", { graph: { termType: "DefaultGraph", value: "urn:g" } }],
    ["non-string graph value", { graph: { termType: "DefaultGraph", value: 1 } }],
    ["non-string blank label", { subject: { termType: "BlankNode", value: 1 } }],
    ...["relative", "_:b0", "@context", "", "urn:bad\n", "urn:bad\\", "urn:bad\uD800", 1].map(
      (value): [string, Record<string, unknown>] => [
        `invalid IRI ${String(value)}`,
        { object: { termType: "NamedNode", value } },
      ],
    ),
    ...[
      { value: 1 },
      { language: 1 },
      { datatype: undefined },
      { datatype: { termType: "BlankNode", value: "urn:d" } },
      { datatype: namedNode("relative") },
      { datatype: namedNode(`${RDF}langString`) },
      { language: "en" },
      { language: "en--rtl", datatype: namedNode(`${RDF}langString`) },
      {
        language: 'en" , "@context": "https://example.org/evil',
        datatype: namedNode(`${RDF}langString`),
      },
      { datatype: namedNode(`${RDF}dirLangString`) },
      ...["rtl", "ltr", "invalid", 7, false].map((direction) => ({ direction })),
    ].map((fields): [string, Record<string, unknown>] => [
      `literal ${JSON.stringify(fields)}`,
      { object: rawLiteral(fields) },
    ]),
  ];
  it.each(invalid)("rejects %s", async (_name, overrides) => {
    await expect(serialize([rawQuad(overrides)], { format: FORMAT })).rejects.toBeInstanceOf(
      TypeError,
    );
  });
});
