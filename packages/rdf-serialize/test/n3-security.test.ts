// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { legacySerialize, safeIri, serialize } from "../src/index.js";

const { namedNode, blankNode, literal, quad } = DataFactory;
const s = namedNode("urn:subject");
const p = namedNode("urn:predicate");
const o = namedNode("urn:object");
const DPV = "https://w3id.org/dpv#";
const ODRL = "http://www.w3.org/ns/odrl/2/";
const FORMATS = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "unknown-format",
];

function rawQuad(fields: Partial<Record<keyof Quad, unknown>>): Quad {
  return {
    subject: s,
    predicate: p,
    object: o,
    graph: DataFactory.defaultGraph(),
    ...fields,
  } as Quad;
}

async function expectRoundTrip(input: Quad[], format: string, prefixes: Record<string, string>) {
  for (const write of [
    () => serialize(input, { format, prefixes }),
    () => legacySerialize(input, format, prefixes),
  ]) {
    const output = await write();
    const parsed = await parseRdf(output, format === "unknown-format" ? "text/turtle" : format);
    expect(parsed.size).toBe(input.length);
    for (const q of input) expect(parsed.has(q)).toBe(true);
  }
}

describe.each(FORMATS)("N3 term and prefix safety (%s)", (format) => {
  it("preserves the ODRL dpv:Research rightOperand IRI instead of expanding its scheme", async () => {
    const input = [
      quad(s, namedNode(`${ODRL}leftOperand`), namedNode(`${ODRL}purpose`)),
      quad(s, namedNode(`${ODRL}operator`), namedNode(`${ODRL}neq`)),
      quad(s, namedNode(`${ODRL}rightOperand`), namedNode("dpv:Research")),
    ];
    await expectRoundTrip(input, format, { odrl: ODRL, dpv: DPV });
  });

  it("round-trips safeIri's dpv punctuation as exactly one input quad", async () => {
    const iri = safeIri("dpv:Research;dpv:purpose(dpv:Public)");
    expect(iri).toBeDefined();
    await expectRoundTrip([quad(s, p, namedNode(iri as string))], format, { dpv: DPV });
  });

  it.each([
    "subject",
    "predicate",
    "object",
    "datatype",
  ])("detects prefix collisions in the %s", async (field) => {
    const term = namedNode("dpv:Research");
    const fields = field === "datatype" ? { object: literal("value", term) } : { [field]: term };
    await expectRoundTrip([rawQuad(fields)], format, { dpv: DPV });
  });

  it("drops dotted prefix names and namespaces with unescaped regex metacharacters", async () => {
    await expectRoundTrip([quad(s, p, namedNode("dpvXv1:Research"))], format, {
      "dpv.v1": DPV,
      ipv6: "https://[::1]/",
    });
    const output = await serialize([quad(s, p, o)], {
      format,
      prefixes: { "dpv.v1": DPV, ipv6: "https://[::1]/" },
    });
    expect(output).not.toContain("@prefix");
  });

  it.each([
    "bad:name",
    "bad name",
    "_invalid",
    "bad;name",
    "bad.",
  ])("rejects invalid prefix name %s", async (name) => {
    await expect(serialize([quad(s, p, o)], { format, prefixes: { [name]: DPV } })).rejects.toThrow(
      TypeError,
    );
  });

  it("rejects an object IRI that would inject a victim triple", async () => {
    const attack = namedNode("https://evil/> . <urn:victim> <urn:admin> <urn:attacker> . #");
    await expect(serialize([quad(s, p, attack)], { format })).rejects.toThrow(TypeError);
  });

  it.each([
    "subject",
    "predicate",
    "object",
    "datatype",
  ])("rejects IRIREF-forbidden characters in the %s", async (field) => {
    for (const char of [" ", "<", ">", '"', "{", "}", "|", "^", "`", "\\", "\u0000", "\n"]) {
      const term = namedNode(`urn:unsafe${char}value`);
      const fields =
        field === "datatype"
          ? { object: { termType: "Literal", value: "value", language: "", datatype: term } }
          : { [field]: term };
      await expect(serialize([rawQuad(fields)], { format })).rejects.toThrow(TypeError);
    }
  });

  it("rejects a crafted language tag before N3 can emit extra triples", async () => {
    const object = {
      termType: "Literal",
      value: "hello",
      language: "en . <urn:victim> <urn:admin> <urn:attacker> . #",
      datatype: namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"),
    };
    await expect(serialize([rawQuad({ object })], { format })).rejects.toThrow(TypeError);
  });

  it("escapes a crafted prefix namespace without injecting statements", async () => {
    const output = await serialize([quad(s, p, o)], {
      format,
      prefixes: { attack: "https://evil/> . <urn:victim> <urn:admin> <urn:attacker> . #" },
    });
    const parsed = await parseRdf(output, format === "unknown-format" ? "text/turtle" : format);
    expect(parsed.size).toBe(1);
    expect(parsed.has(quad(s, p, o))).toBe(true);
  });

  it("validates prefix names even for empty inputs", async () => {
    await expect(serialize([], { format, prefixes: { "bad:name": DPV } })).rejects.toThrow(
      TypeError,
    );
  });

  it("preserves valid Unicode and empty prefix labels", async () => {
    await expectRoundTrip(
      [quad(s, p, namedNode(`${DPV}Research`))],
      format,
      Object.fromEntries([
        ["é", DPV],
        ["", "urn:"],
      ]),
    );
  });

  it("preserves valid astral IRIs, literal escaping, language tags and PN_CHARS blank labels", async () => {
    const subject = namedNode("https://example.org/日本語/😀");
    await expectRoundTrip(
      [
        quad(subject, p, literal('日本語 😀 " \\ \n\r\t\u0000')),
        quad(subject, p, literal("hello", "en-Latn-GB-1994")),
      ],
      format,
      {},
    );
    const output = await serialize([quad(blankNode("É.a-1"), p, o)], { format });
    expect(output).toContain("_:É.a-1");
    const parsed = await parseRdf(output, format === "unknown-format" ? "text/turtle" : format);
    expect(parsed.size).toBe(1);
  });

  it("keeps one empty blank-node identity and avoids snapshot-label collisions", async () => {
    const empty = { termType: "BlankNode", value: "" };
    const output = await serialize(
      [
        rawQuad({ subject: empty, object: empty }),
        quad(blankNode("snapshot0"), p, blankNode("x0")),
      ],
      { format },
    );
    const parsed = [
      ...(await parseRdf(output, format === "unknown-format" ? "text/turtle" : format)),
    ];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.subject.equals(parsed[0]?.object as Term)).toBe(true);
    const labels = new Set(parsed.flatMap((q) => [q.subject.value, q.object.value]));
    expect(labels.size).toBe(3);
  });

  it.each([
    { subject: literal("invalid subject") },
    { predicate: blankNode("predicate") },
    { graph: literal("invalid graph") },
    { graph: { termType: "DefaultGraph", value: "forged" } },
    { object: { termType: "Variable", value: "x . <urn:victim>" } },
    { object: { termType: "NamedNode", value: 42 } },
    { object: namedNode("relative") },
    { object: namedNode("urn:lone\uD800surrogate") },
    {
      object: { termType: "Literal", value: 42, language: "", datatype: namedNode("urn:datatype") },
    },
    {
      object: {
        termType: "Literal",
        value: "x",
        language: "en",
        datatype: namedNode("urn:datatype"),
      },
    },
    {
      object: {
        termType: "Literal",
        value: "x",
        language: "",
        datatype: namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"),
      },
    },
    { object: { termType: "Literal", value: "x", language: "", datatype: blankNode("datatype") } },
    {
      object: {
        termType: "Literal",
        value: "x",
        language: "en",
        datatype: namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"),
        direction: "evil",
      },
    },
  ])("rejects malformed RDF/JS fields %#", async (fields) => {
    await expect(serialize([rawQuad(fields)], { format })).rejects.toThrow(TypeError);
  });

  it("preserves typed literals whose datatype contains -- despite N3's direction getter", async () => {
    await expectRoundTrip(
      [quad(s, p, literal("example", namedNode("urn:example:datatype--item")))],
      format,
      {},
    );
  });

  it("retains validated N3 Patch variables in every triple position", async () => {
    const term = (value: string) => ({ termType: "Variable", value });
    const output = await serialize(
      [rawQuad({ subject: term("s"), predicate: term("p"), object: term("o") })],
      { format },
    );
    expect(output).toMatch(/^\?s \?p \?o ?\.\n$/);
  });

  it("preserves validated language-tag spelling on foreign RDF/JS literals", async () => {
    const object = {
      termType: "Literal",
      value: "Hello",
      language: "EN-US",
      datatype: namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#langString"),
    };
    const output = await serialize([rawQuad({ object })], { format });
    expect(output).toContain('"Hello"@EN-US');
    const parsed = await parseRdf(output, format === "unknown-format" ? "text/turtle" : format);
    expect(parsed.size).toBe(1);
    expect(parsed.has(quad(s, p, literal("Hello", "en-us")))).toBe(true);
  });

  it("relabels crafted blank-node labels and avoids collisions with safe labels", async () => {
    const unsafe = blankNode("bad . <urn:victim> <urn:admin> <urn:attacker> . #");
    const input = [quad(unsafe, p, unsafe), quad(blankNode("x0"), p, unsafe)];
    const output = await serialize(input, { format });
    const parsed = [
      ...(await parseRdf(output, format === "unknown-format" ? "text/turtle" : format)),
    ];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.subject.termType).toBe("BlankNode");
    expect(parsed[0]?.subject.equals(parsed[0]?.object as Term)).toBe(true);
    expect(parsed[1]?.object.equals(parsed[0]?.subject as Term)).toBe(true);
    expect(parsed[1]?.subject.equals(parsed[0]?.subject as Term)).toBe(false);
    expect(output).not.toContain("urn:victim");
  });

  it("reads RDF/JS fields without invoking caller methods or trusting N3's private id", async () => {
    const method = vi.fn(() => {
      throw new Error("caller method invoked");
    });
    const object = { termType: "NamedNode", value: "urn:object", id: "urn:forged", equals: method };
    const parsed = await parseRdf(
      await serialize([rawQuad({ object })], { format }),
      format === "unknown-format" ? "text/turtle" : format,
    );
    expect(parsed.has(quad(s, p, o))).toBe(true);
    expect(method).not.toHaveBeenCalled();
  });
});

it.each([
  "application/n-quads",
  "application/trig",
])("checks graph IRIs too (%s)", async (format) => {
  await expectRoundTrip([quad(s, p, o, namedNode("dpv:Research"))], format, { dpv: DPV });
  await expect(serialize([quad(s, p, o, namedNode("urn:bad>graph"))], { format })).rejects.toThrow(
    TypeError,
  );
});
