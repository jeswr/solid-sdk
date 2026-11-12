// AUTHORED-BY Claude Opus 5.5
// Worker reports must name the caller's own blank nodes, exactly as in-process
// validation does, not the safe b<n> labels the transfer substitutes.
import { EventEmitter } from "node:events";
import type { Worker } from "node:worker_threads";
import type { Quad, Quad_Subject } from "@rdfjs/types";
import { DataFactory } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/index.js";
import { validateGraphs } from "../src/validationCore.js";
import { RDF, SH, XSD } from "../src/vocab.js";
import { validationPaths } from "./validationPaths.js";

const { blankNode, literal, namedNode, quad } = DataFactory;
const EX = "urn:ex:";
const ex = (local: string) => namedNode(`${EX}${local}`);
const sh = (local: string) => namedNode(`${SH}${local}`);
const type = namedNode(`${RDF}type`);
const pools: api.ValidationWorkerPool[] = [];
const makePool = (options: api.ValidationWorkerPoolOptions) => {
  const pool = new api.ValidationWorkerPool(options);
  pools.push(pool);
  return pool;
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(pools.splice(0).map((pool) => pool.close()));
});

/** A blank-node shape over ex:Thing, so the shapes take the first b<n> labels. */
function thingShape(property: (prop: Quad_Subject) => Quad[], label = "shape"): Quad[] {
  const shape = blankNode(label);
  const prop = blankNode(`${label}-prop`);
  return [
    quad(shape, type, sh("NodeShape")),
    quad(shape, sh("targetClass"), ex("Thing")),
    quad(shape, sh("property"), prop),
    ...property(prop),
  ];
}
const nameRequired = () =>
  thingShape((prop) => [
    quad(prop, sh("path"), ex("name")),
    quad(prop, sh("minCount"), literal("1", namedNode(`${XSD}integer`))),
  ]);
const missingName = (label: string): Quad[] => [quad(blankNode(label), type, ex("Thing"))];

describe.each(validationPaths)("%s report identities", (_mode, validateIntent) => {
  it("reports a caller blank focus node by its own label", async () => {
    const report = await validateIntent(missingName("caller-node"), nameRequired());
    expect(report.conforms).toBe(false);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      focusNode: "caller-node",
      path: `${EX}name`,
      sourceConstraintComponent: `${SH}MinCountConstraintComponent`,
    });
  });

  it("reports a caller blank value by its own label, leaving a named focus node alone", async () => {
    const shape = thingShape((prop) => [
      quad(prop, sh("path"), ex("knows")),
      quad(prop, sh("nodeKind"), sh("IRI")),
    ]);
    const data = [
      quad(ex("s"), type, ex("Thing")),
      quad(ex("s"), ex("knows"), blankNode("caller-value")),
    ];
    const report = await validateIntent(data, shape);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      focusNode: `${EX}s`,
      path: `${EX}knows`,
      value: "caller-value",
    });
  });

  it("never rewrites a literal value that spells a transfer label", async () => {
    const shape = thingShape((prop) => [
      quad(prop, sh("path"), ex("age")),
      quad(prop, sh("datatype"), namedNode(`${XSD}integer`)),
    ]);
    const node = blankNode("caller-node");
    const data = [
      quad(node, type, ex("Thing")),
      quad(node, ex("other"), blankNode("other")),
      quad(node, ex("age"), literal("b0")),
      quad(node, ex("age"), literal("b3")),
    ];
    const report = await validateIntent(data, shape);
    expect(report.results.map((r) => [r.focusNode, r.value]).sort()).toEqual([
      ["caller-node", "b0"],
      ["caller-node", "b3"],
    ]);
  });

  it("reports a complex path by the caller's shape blank node", async () => {
    const shape = thingShape((prop) => {
      const path = blankNode("caller-path");
      return [
        quad(prop, sh("path"), path),
        quad(path, sh("inversePath"), ex("parentOf")),
        quad(prop, sh("maxCount"), literal("0", namedNode(`${XSD}integer`))),
      ];
    });
    const child = blankNode("caller-child");
    const data = [quad(child, type, ex("Thing")), quad(ex("parent"), ex("parentOf"), child)];
    const report = await validateIntent(data, shape);
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ focusNode: "caller-child", path: "caller-path" });
  });
});

describe("worker report identities", () => {
  it("matches in-process reports for every caller blank node", async () => {
    const shape = nameRequired();
    const data = [...missingName("one"), ...missingName("two")];
    const worker = await api.validateIntent(data, shape);
    const inProcess = await api.validateIntent(data, shape, { execution: "in-process" });
    expect(worker).toEqual(inProcess);
    expect(worker.results.map((r) => r.focusNode).sort()).toEqual(["one", "two"]);
  });

  it("restores the cached shape encoding's labels on reuse", async () => {
    const shape = thingShape((prop) => {
      const path = blankNode("cached-path");
      return [
        quad(prop, sh("path"), path),
        quad(path, sh("inversePath"), ex("parentOf")),
        quad(prop, sh("maxCount"), literal("0", namedNode(`${XSD}integer`))),
      ];
    });
    const workerPool = makePool({ size: 1 });
    for (const label of ["first", "second"]) {
      const child = blankNode(label);
      const data = [quad(child, type, ex("Thing")), quad(ex("parent"), ex("parentOf"), child)];
      const report = await api.validateIntent(data, shape, { workerPool });
      expect(report.results[0]).toMatchObject({ focusNode: label, path: "cached-path" });
    }
  });

  it.each([1, 2])("keeps concurrent jobs' colliding labels apart (size %i)", async (size) => {
    const workerPool = makePool({ size });
    const shape = nameRequired();
    // Each job's first data blank node takes the same b<n> label; the second pair
    // reverses the order, so one caller label maps to different b<n> per job.
    const jobs = [["alpha"], ["beta"], ["p", "q"], ["q", "p"], ["shared"], ["shared"]];
    const reports = await Promise.all(
      jobs.map((labels) =>
        api.validateIntent(labels.flatMap(missingName), shape, { workerPool, timeoutMs: 20_000 }),
      ),
    );
    for (const [index, labels] of jobs.entries()) {
      const report = reports[index] as api.ValidationReport;
      expect(report.conforms).toBe(false);
      expect(report.results.map((r) => r.focusNode).sort()).toEqual([...labels].sort());
    }
  });
});

class ControlledWorker extends EventEmitter {
  ref = vi.fn(() => this);
  unref = vi.fn(() => this);
  terminate = vi.fn(async () => {
    this.emit("exit", 0);
    return 0;
  });
  constructor(private readonly report: (id: number) => unknown) {
    super();
    setTimeout(() => this.emit("message", { ready: true }), 0);
  }
  postMessage = vi.fn((request: { id: number }) => {
    queueMicrotask(() => this.emit("message", { id: request.id, report: this.report(request.id) }));
  });
}

describe("worker report identity restoration", () => {
  const data = missingName("caller-node");
  const run = (report: unknown) => {
    const worker = new ControlledWorker(() => report);
    const workerPool = makePool({ size: 1, workerFactory: () => worker as unknown as Worker });
    return { worker, result: api.validateIntent(data, nameRequired(), { workerPool }) };
  };
  const failing = (entry: Record<string, unknown>) => ({
    conforms: false,
    results: [{ message: "m", ...entry }],
  });

  it("maps marked blank-node fields back and strips the marker", async () => {
    // The two shape blank nodes take b0 and b1; the data node takes b2.
    const { result } = run(
      failing({
        focusNode: "b2",
        value: "b0",
        path: "b1",
        blankNodes: ["focusNode", "value", "path"],
      }),
    );
    expect(await result).toEqual({
      conforms: false,
      results: [{ message: "m", focusNode: "caller-node", value: "shape", path: "shape-prop" }],
    });
  });

  it("passes unmarked fields through unchanged", async () => {
    const { result } = run(failing({ focusNode: "b2", value: "b0" }));
    expect(await result).toEqual(failing({ focusNode: "b2", value: "b0" }));
  });

  it.each([
    ["an unknown label", { focusNode: "b99", blankNodes: ["focusNode"] }],
    ["an inherited key", { focusNode: "constructor", blankNodes: ["focusNode"] }],
    ["a marked field that is absent", { blankNodes: ["value"] }],
    ["a marked field that is not a string", { value: 3, blankNodes: ["value"] }],
    ["an unknown marked field", { message: "b2", blankNodes: ["message"] }],
    ["a repeated marker", { focusNode: "b2", blankNodes: ["focusNode", "focusNode"] }],
    ["a non-array marker", { focusNode: "b2", blankNodes: "focusNode" }],
  ])("fails closed on %s", async (_name, entry) => {
    const { worker, result } = run(failing(entry));
    expect(await result).toMatchObject({
      conforms: false,
      results: [{ message: expect.stringContaining("invalid message") }],
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("fails closed on a result entry that is not an object", async () => {
    const { result } = run({ conforms: false, results: [null] });
    expect(await result).toMatchObject({
      results: [{ message: expect.stringContaining("invalid message") }],
    });
  });
});

describe("worker-side blank-node marking", () => {
  it("marks only blank-node term fields, and only when asked", async () => {
    const shape = thingShape((prop) => [
      quad(prop, sh("path"), ex("knows")),
      quad(prop, sh("nodeKind"), sh("Literal")),
    ]);
    const node = blankNode("b0");
    const data = [
      quad(node, type, ex("Thing")),
      quad(node, ex("knows"), blankNode("b1")),
      quad(ex("s"), type, ex("Thing")),
      quad(ex("s"), ex("knows"), ex("o")),
    ];
    const marked = await validateGraphs(data, shape, true);
    expect(
      marked.results.map((r) => [r.focusNode, r.value, (r as { blankNodes?: unknown }).blankNodes]),
    ).toEqual(
      expect.arrayContaining([
        ["b0", "b1", ["focusNode", "value"]],
        [`${EX}s`, `${EX}o`, undefined],
      ]),
    );
    expect(marked.results).toHaveLength(2);
    const plain = await validateGraphs(data, shape);
    expect(plain.results.every((r) => !("blankNodes" in r))).toBe(true);
  });
});
