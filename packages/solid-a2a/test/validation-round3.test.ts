// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Literal, Quad } from "@rdfjs/types";
import { DataFactory } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/index.js";
import { checkedQuads } from "../src/validationLimits.js";
import * as transfer from "../src/validationTransfer.js";

const { namedNode, blankNode, literal, quad } = DataFactory;
const sh = (local: string) => namedNode(`http://www.w3.org/ns/shacl#${local}`);
const rdfType = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const requiredShape = [
  quad(namedNode("urn:S"), sh("targetClass"), namedNode("urn:C")),
  quad(namedNode("urn:S"), sh("property"), namedNode("urn:P")),
  quad(namedNode("urn:P"), sh("path"), namedNode("urn:required")),
  quad(namedNode("urn:P"), sh("minCount"), literal(1)),
];
const pools: api.ValidationWorkerPool[] = [];
const makePool = () => {
  const pool = new api.ValidationWorkerPool({ size: 1 });
  pools.push(pool);
  return pool;
};
const bothPaths = async (data: readonly Quad[], shapes: api.ShapeInput, conforms: boolean) => {
  const worker = await api.validateIntent(data, shapes, { timeoutMs: 10_000 });
  const local = await api.validateIntent(data, shapes, { execution: "in-process" });
  expect(worker.conforms).toBe(local.conforms);
  expect(worker.conforms).toBe(conforms);
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

describe("round 3 transfer security regressions", () => {
  it.each([
    false,
    true,
  ])("rechecks terms changed during async pool admission (shapes=%s)", async (shapeMutation) => {
    const subject = namedNode(shapeMutation ? "urn:S" : "urn:s");
    const shapes = shapeMutation
      ? [quad(subject, sh("targetClass"), namedNode("urn:C")), ...requiredShape.slice(1)]
      : requiredShape;
    const data = [quad(shapeMutation ? namedNode("urn:s") : subject, rdfType, namedNode("urn:C"))];
    const pending = api.validateIntent(data, shapes, { workerPool: makePool(), timeoutMs: 10_000 });
    Object.defineProperty(subject, "value", { value: "urn:x> <urn:q> <urn:o> . #" });
    expect(await pending).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringMatching(/IRI.*syntax/) }],
    });
  });

  it.each([
    blankNode('y <urn:required> "1" . #'),
    namedNode("urn:x> <urn:q> <urn:o> . #"),
  ])("does not let a hostile $termType subject erase its class (inject.mjs)", async (subject) => {
    await bothPaths([quad(subject, rdfType, namedNode("urn:C"))], requiredShape, false);
  });

  it("validates the original JSON-LD blank node, including actual required values (inject3.mjs)", async () => {
    const document = { "@id": '_:y <urn:required> "1" . #', "@type": "urn:C" };
    const data = [...(await parseRdf(JSON.stringify(document), "application/ld+json"))];
    expect(data[0]?.subject.value).toContain(" . #");
    await bothPaths(data, requiredShape, false);
    const subject = data[0]?.subject as Quad["subject"];
    data.push(quad(subject, namedNode("urn:required"), literal("real")));
    await bothPaths(data, requiredShape, true);
  });

  it.each([
    "subject",
    "predicate",
    "object",
    "graph",
    "datatype",
  ] as const)("refuses forbidden IRI characters in %s in either graph before transfer", async (position) => {
    for (const character of [
      " ",
      "\t",
      "\n",
      "\u0000",
      "\u007f",
      "\u0085",
      "\u00a0",
      "<",
      ">",
      '"',
      "{",
      "}",
      "|",
      "^",
      "`",
      "\\",
    ]) {
      const iri = namedNode(`urn:bad${character}value`);
      const object = position === "object" ? iri : literal("x");
      // N3 encodes literal metadata in its id; use an independent RDF/JS field
      // so even a quote in the datatype remains the exact term under test.
      if (position === "datatype") Object.defineProperty(object, "datatype", { value: iri });
      const q = quad(
        position === "subject" ? iri : namedNode("urn:s"),
        position === "predicate" ? iri : namedNode("urn:p"),
        object,
        position === "graph" ? iri : DataFactory.defaultGraph(),
      );
      for (const shapes of [false, true]) {
        expect(() => checkedQuads([q], shapes)).toThrow(/IRI.*syntax/);
        await bothPaths(shapes ? [] : [q], shapes ? [q] : [], false);
      }
    }
  });

  it.each([
    "en . #",
    "en--rtl",
    "en_US",
    "en-",
    "a",
    "en-a",
    "en-a-foo-a-bar",
    "de-1901-1901",
  ])("refuses malformed or ambiguous language %s in both paths", async (language) => {
    const object = literal("x", "en");
    Object.defineProperty(object, "language", { value: language });
    const data = [quad(namedNode("urn:s"), namedNode("urn:p"), object)];
    expect(() => checkedQuads(data, false)).toThrow(/language tag/i);
    await bothPaths(data, [], false);
  });

  it.each([
    "en",
    "zh-Hant-TW",
    "de-CH-1901",
    "en-a-foo-x-private",
    "x-private",
    "i-klingon",
    "en-GB-oed",
  ])("retains valid BCP 47 language %s and separate RDF direction", async (language) => {
    const directional = literal as unknown as (
      value: string,
      options: { language: string; direction: string },
    ) => Literal;
    for (const direction of ["", "ltr", "rtl"]) {
      await bothPaths(
        [
          quad(
            namedNode("urn:s"),
            namedNode("urn:p"),
            directional("text", { language, direction }),
          ),
        ],
        [],
        true,
      );
    }
  });

  it("shares one collision-free blank-node mapping across cached shapes and each new intent", async () => {
    const focus = blankNode('focus <urn:q> "v" . #');
    const shapes = [
      quad(blankNode("b0"), sh("targetNode"), focus),
      quad(blankNode("b0"), sh("path"), namedNode("urn:p")),
      quad(blankNode("b0"), sh("hasValue"), blankNode("b1")),
    ];
    for (const extra of [[], [quad(blankNode("different"), namedNode("urn:p"), blankNode("b0"))]]) {
      await bothPaths([...extra, quad(focus, namedNode("urn:p"), blankNode("b1"))], shapes, true);
      await bothPaths([...extra, quad(focus, namedNode("urn:p"), blankNode("b0"))], shapes, false);
    }
  });

  it.each([
    false,
    true,
  ])("charges escaped characters against aggregate budgets (shapes=%s, enc.mjs)", (shapes) => {
    for (const text of [
      "\u0001".repeat(4000),
      '"'.repeat(4000),
      "\\".repeat(4000),
      "😀".repeat(2000),
    ]) {
      const input = Array.from({ length: shapes ? 1030 : 250 }, (_, index) =>
        quad(namedNode(`urn:${index}`), namedNode("urn:p"), literal(text)),
      );
      expect(() => checkedQuads(input, shapes)).toThrow(/total characters/);
    }
  });

  it.each([
    false,
    true,
  ])("encodes a reused shape only once (ProtocolDocument=%s)", async (protocol) => {
    const shapes = [...requiredShape];
    const input = protocol
      ? await api.buildProtocolDocument({
          requestShape: shapes,
          responseShape: [],
          meta: { id: "urn:protocol", name: "cache", version: "1" },
        })
      : shapes;
    const encode = vi.spyOn(transfer, "encodeValidationQuads");
    const workerPool = makePool();
    for (const id of ["urn:first", "urn:second"]) {
      await api.validateIntent([quad(namedNode(id), rdfType, namedNode("urn:C"))], input, {
        workerPool,
        timeoutMs: 10_000,
      });
    }
    expect(encode.mock.calls.filter(([quads]) => quads.length === shapes.length)).toHaveLength(1);
  });

  it("invalidates the shape cache when a reused input changes", async () => {
    const subject = namedNode("urn:s");
    const shapes = [
      quad(namedNode("urn:S"), sh("targetNode"), subject),
      quad(namedNode("urn:S"), sh("path"), namedNode("urn:p")),
      quad(namedNode("urn:S"), sh("hasValue"), literal("initial")),
    ];
    const data = [quad(subject, namedNode("urn:p"), literal("initial"))];
    const workerPool = makePool();
    const validate = () => api.validateIntent(data, shapes, { workerPool, timeoutMs: 10_000 });
    expect((await validate()).conforms).toBe(true);
    shapes[2] = quad(namedNode("urn:S"), sh("hasValue"), literal("changed"));
    expect((await validate()).conforms).toBe(false);
    const initial = literal("initial");
    shapes[2] = quad(namedNode("urn:S"), sh("hasValue"), initial);
    expect((await validate()).conforms).toBe(true);
    // RDF/JS interfaces are readonly, but caller objects can still mutate in place.
    Object.defineProperty(initial, "value", { value: "mutated" });
    expect((await validate()).conforms).toBe(false);
  });

  it("checks the deadline between graph encodings", async () => {
    const workerPool = makePool();
    await api.validateIntent([], [], { workerPool, timeoutMs: 10_000 });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const encode = transfer.encodeValidationQuads;
    const calls = vi
      .spyOn(transfer, "encodeValidationQuads")
      .mockImplementation((quads, ...rest) => {
        now = 2001;
        return encode(quads, ...rest);
      });
    const report = await api.validateIntent([], [...requiredShape], { workerPool });
    expect(report.conforms).toBe(false);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it.each([
    "language",
    "datatype",
    "direction",
  ])("invalidates cached literal %s metadata", async (field) => {
    const value = literal("text", "en");
    const data = [quad(namedNode("urn:s"), namedNode("urn:p"), value)];
    const shapes = [
      quad(namedNode("urn:S"), sh("targetNode"), namedNode("urn:s")),
      quad(namedNode("urn:S"), sh("path"), namedNode("urn:p")),
      quad(namedNode("urn:S"), sh("hasValue"), value),
    ];
    await bothPaths(data, shapes, true);
    const directional = literal as unknown as (
      value: string,
      options: { language: string; direction: string },
    ) => Literal;
    const changed =
      field === "language"
        ? literal("text", "fr")
        : field === "datatype"
          ? literal("text", namedNode("urn:datatype"))
          : directional("text", { language: "en", direction: "rtl" });
    shapes[2] = quad(namedNode("urn:S"), sh("hasValue"), changed);
    await bothPaths(data, shapes, false);
  });

  it("invalidates a ProtocolDocument cache when its request shape is replaced, and reapplies caps", async () => {
    const protocol = await api.buildProtocolDocument({
      requestShape: requiredShape,
      meta: { id: "urn:cached", name: "cache" },
    });
    const data = [quad(namedNode("urn:s"), rdfType, namedNode("urn:C"))];
    await bothPaths(data, protocol, false);
    Object.defineProperty(protocol, "requestShapeQuads", { value: [], configurable: true });
    await bothPaths(data, protocol, true);
    Object.defineProperty(protocol, "requestShapeQuads", { value: new Array(10001) });
    await bothPaths(data, protocol, false);
  });

  it.each([
    1, 2,
  ])("bounds caller loop gaps for %i concurrent escape-heavy calls (esc.mjs)", async (concurrency) => {
    await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("./fixtures/validation-round3.mjs", import.meta.url)),
        String(concurrency),
      ],
      { timeout: 20_000 },
    );
  });

  it.each([9, 32])("refuses size=%i to bound combined worker heaps", (size) => {
    expect(() => new api.ValidationWorkerPool({ size })).toThrow(/between 1 and 8/);
  });

  it("keeps sampled heap below 384 MiB at both quad caps with named graphs (heap.mjs)", async () => {
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("./fixtures/validation-heap.mjs", import.meta.url))],
      { timeout: 20_000 },
    );
  });
});
