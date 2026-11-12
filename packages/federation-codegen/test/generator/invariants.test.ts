// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createHash } from "node:crypto";
import { defineModel, isCompositeEntity } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  AdmissionError,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  deriveNodeViews,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
  serializeCanonicalTurtle,
} from "../../src/index.js";
import {
  baseShapes,
  config,
  EX,
  H,
  ontologyTtl,
  safetyShapes,
} from "../fixtures/diet-invariants.js";
import { flat } from "../helpers.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture value");
  return value;
}
const generate = (shapesTtl = baseShapes + safetyShapes, cfg = config) =>
  generateModel({ ontologyTtl, shapesTtl, config: cfg, admissionNamespace: EX });
const normalized = (ttl: string) =>
  parseShapes(
    ttl,
    config.shapesBase,
    owlRdfsAdapter.adapt(parseTurtle(ontologyTtl)),
    parseTurtle(ontologyTtl),
    config,
  );
const atom = "[ sh:path diet:coverageComplete; sh:hasValue true ]";
const safety = (constraint: string, metadata = "") =>
  `${baseShapes} diet:Safety a sh:NodeShape; sh:targetClass diet:GeneticSummary; ${metadata} ${constraint}.`;
const engine = createRdfEngine();
afterAll(() => engine.dispose());

describe("closed property hasValue admission", () => {
  it.each([
    ["xsd:boolean", "true", ""],
    ["xsd:integer", "1", ""],
    ["xsd:string", '"ok"', ""],
    ["xsd:boolean", "false", "sh:in (true false);"],
  ])("admits compatible %s %s", (datatype, value, extra) => {
    const ttl = baseShapes.replace(
      "sh:datatype xsd:boolean; sh:maxCount 1; sh:hasValue true",
      `sh:datatype ${datatype}; sh:maxCount 1; ${extra} sh:hasValue ${value}`,
    );
    const field = flat(
      generate(ttl).manifest.entities.find((e) => e.name === "Summary"),
    ).fields.find((f) => f.name === "consentGiven");
    expect(field?.hasValue?.severity).toBe("Violation");
  });
  it("admits a compatible class-derived IRI enum member", () => {
    const ttl = baseShapes.replace(
      "sh:path diet:riskHaplotype;",
      "sh:path diet:riskHaplotype; sh:hasValue diet:DQ7;",
    );
    expect(
      flat(generate(ttl).manifest.entities.find((e) => e.name === "Marker")).fields.find(
        (f) => f.name === "riskHaplotype",
      )?.hasValue,
    ).toMatchObject({ term: { kind: "iri", value: `${EX}DQ7` }, severity: "Warning" });
  });
  it.each([
    "sh:hasValue true, false",
    'sh:hasValue "true"',
    'sh:hasValue "1"^^xsd:boolean',
    "sh:hasValue []",
    "sh:hasValue diet:DQ7",
    "sh:in (false); sh:hasValue true",
    "sh:hasValue true; sh:maxCount 2",
    "sh:hasValue true; sh:node diet:MarkerShape",
  ])("rejects incompatible or multiple values: %s", (constraint) => {
    expect(() => generate(baseShapes.replace("sh:hasValue true", constraint))).toThrow();
  });
  it("rejects collection-valued property hasValue", () => {
    expect(() =>
      generate(
        baseShapes.replace(
          "sh:datatype xsd:boolean; sh:maxCount 1; sh:hasValue true",
          "sh:datatype xsd:boolean; sh:hasValue true",
        ),
      ),
    ).toThrow(AdmissionError);
  });
  it("retains the strongest source severity and rejects conflicting merged values", () => {
    const ttl = `${baseShapes} diet:ConsentSafety a sh:NodeShape; sh:targetClass diet:GeneticSummary;
      sh:property [ sh:path diet:consentGiven; sh:hasValue true; sh:severity sh:Warning ].`;
    expect(
      flat(generate(ttl).manifest.entities.find((e) => e.name === "Summary")).fields.find(
        (f) => f.name === "consentGiven",
      )?.hasValue?.severity,
    ).toBe("Violation");
    expect(() =>
      generate(ttl.replace("sh:hasValue true; sh:severity", "sh:hasValue false; sh:severity")),
    ).toThrow(/hasValue/);
  });
  it("fidelity catches removal, term changes and severity weakening", () => {
    for (const change of ["remove", "term", "severity"]) {
      const shapes = normalized(baseShapes);
      const compiled = compileManifest(shapes, config);
      const field = must(
        flat(compiled.manifest.entities.find((e) => e.name === "Summary")).fields.find(
          (f) => f.hasValue,
        ),
      );
      const constraint = must(field.hasValue);
      if (change === "remove") delete field.hasValue;
      else if (change === "term") constraint.term.value = "false";
      else constraint.severity = "Warning";
      expect(() => assertFidelity(shapes, compiled)).toThrow(/hasValue/);
    }
  });
});

describe("node logical closed grammar and limits", () => {
  it.each([
    `sh:not ${atom}`,
    `sh:and (${atom})`,
    `sh:or (${atom} [sh:not ${atom}])`,
  ])("admits every operator: %s", (constraint) => {
    const entity = flat(
      generate(safety(constraint)).manifest.entities.find((e) => e.name === "Summary"),
    );
    expect(entity.invariants?.[0]).toMatchObject({ shape: `${EX}Safety`, severity: "Violation" });
  });
  it.each(["Warning", "Info", "Violation"])("retains %s severity and message", (severity) => {
    const owner = flat(
      generate(
        safety(`sh:not ${atom}`, `sh:severity sh:${severity}; sh:message "message"@en;`),
      ).manifest.entities.find((e) => e.name === "Summary"),
    );
    expect(owner.invariants?.[0]).toMatchObject({ severity, message: "message" });
  });
  it.each([
    "sh:xone ( [sh:path diet:coverageComplete; sh:hasValue true] )",
    "sh:and ()",
    "sh:or ()",
    "sh:not []",
    'sh:not "literal"',
    `sh:not ${atom}, ${atom}`,
    `sh:not [sh:and (${atom}); sh:or (${atom})]`,
    `sh:not [sh:path diet:coverageComplete; sh:hasValue true; sh:message "nested metadata"]`,
    `sh:not [sh:path diet:coverageComplete; sh:hasValue true; rdfs:label "nested label"]`,
    `sh:not [sh:path diet:coverageComplete; sh:hasValue true; diet:unknown true]`,
    `sh:not [sh:node diet:MarkerShape]`,
    `sh:and ([sh:node diet:MarkerShape])`,
    `sh:not [sh:path [sh:inversePath diet:coverageComplete]; sh:hasValue true]`,
    `sh:not [sh:path (diet:coverageComplete); sh:hasValue true]`,
    `sh:not [sh:path diet:unknown; sh:hasValue true]`,
    `sh:not [sh:path diet:coverageComplete; sh:hasValue 1]`,
    `sh:not [sh:path diet:hlaMarker; sh:qualifiedMaxCount 1; sh:qualifiedValueShape ${atom}]`,
    `sh:not [sh:path diet:hlaMarker; sh:qualifiedMinCount 1; sh:qualifiedValueShapesDisjoint true; sh:qualifiedValueShape ${atom}]`,
    `sh:not [sh:path diet:coverageComplete; sh:qualifiedMinCount 1; sh:qualifiedValueShape ${atom}]`,
    `sh:not [sh:path diet:hlaMarker; sh:qualifiedMinCount 1; sh:qualifiedValueShape [sh:path diet:coverageComplete; sh:hasValue true]]`,
    `diet:unknown true; sh:not ${atom}`,
  ])("rejects unsupported grammar: %s", (constraint) => {
    expect(() => generate(safety(constraint))).toThrow(AdmissionError);
  });
  it.each([
    "0",
    "-1",
    "17",
    '"1"',
    '"1"^^xsd:int',
    "1.5",
  ])("rejects qualified count %s", (count) => {
    expect(() =>
      generate(
        safety(
          `sh:not [ sh:path diet:hlaMarker; sh:qualifiedMinCount ${count}; sh:qualifiedValueShape [sh:path diet:markerPresence; sh:hasValue diet:markerPresent] ]`,
        ),
      ),
    ).toThrow(AdmissionError);
  });
  it.each([1, 16])("admits qualified count boundary %i", (count) => {
    expect(
      generate(
        safety(
          `sh:not [ sh:path diet:hlaMarker; sh:qualifiedMinCount ${count}; sh:qualifiedValueShape [sh:path diet:markerPresence; sh:hasValue diet:markerPresent] ]`,
        ),
      ).admission.ok,
    ).toBe(true);
  });
  it("accepts depth 4, rejects depth 5", () => {
    let expr = atom;
    for (let i = 0; i < 3; i++) expr = `[sh:not ${expr}]`;
    expect(generate(safety(`sh:not ${expr}`)).admission.ok).toBe(true);
    expect(() => generate(safety(`sh:not [sh:not ${expr}]`))).toThrow(/depth/);
  });
  it("accepts 16 atoms and rejects 17, including across multiple operators", () => {
    const sixteen = Array.from({ length: 16 }, () => atom).join(" ");
    expect(generate(safety(`sh:and (${sixteen})`)).admission.ok).toBe(true);
    expect(() => generate(safety(`sh:and (${sixteen} ${atom})`))).toThrow(/16/);
    expect(() => generate(safety(`sh:and (${sixteen}); sh:not ${atom}`))).toThrow(/atoms/);
  });
  it.each([
    `sh:and (_:same _:same). _:same sh:path diet:coverageComplete; sh:hasValue true`,
    `sh:not _:cycle. _:cycle sh:not _:cycle`,
    `sh:and _:cell. _:cell rdf:first ${atom}; rdf:rest _:cell`,
    `sh:or _:cell. _:cell rdf:first ${atom}`,
    `sh:or _:cell. _:cell rdf:first ${atom}, ${atom}; rdf:rest rdf:nil`,
    `sh:or _:cell. _:cell rdf:first ${atom}; rdf:rest rdf:nil; diet:extra true`,
    `sh:and _:cell; sh:or _:cell. _:cell rdf:first ${atom}; rdf:rest rdf:nil`,
    `sh:not _:expr. diet:Unrelated diet:points _:expr. _:expr sh:path diet:coverageComplete; sh:hasValue true`,
  ])("rejects malformed/reused RDF graph nodes: %s", (constraint) => {
    expect(() => generate(safety(constraint))).toThrow(AdmissionError);
  });
  it("checks additional merged safety shapes, in deterministic shape order", () => {
    const compiled = generate();
    const summary = flat(compiled.manifest.entities.find((e) => e.name === "Summary"));
    expect(summary.invariants?.map((i) => i.shape)).toEqual([
      `${EX}CoverageSafety`,
      `${EX}MarkerSafety`,
    ]);
    const permuted = serializeCanonicalTurtle(
      parseTurtle(baseShapes + safetyShapes).reverse(),
      {},
      "N-Triples",
    );
    for (const name of ["model.json", "model.js", "model.d.ts", "shapes.ttl"])
      expect(generate(permuted).artifacts[name]).toBe(compiled.artifacts[name]);
    expect(createHash("sha256").update(must(compiled.artifacts["model.json"])).digest("hex")).toBe(
      "8852f66648cf73de87281463281159017b19d0173f2c1df28a320d4aefc582cf",
    );
  });
  it.each([
    "drop",
    "expression",
    "severity",
    "message",
    "shape",
    "add",
  ])("fidelity rejects invariant tampering: %s", (mutation) => {
    const shapes = normalized(baseShapes + safetyShapes);
    const compiled = compileManifest(shapes, config);
    const owner = flat(compiled.manifest.entities.find((e) => e.name === "Summary"));
    const i = must(owner.invariants?.[0]);
    if (mutation === "drop") delete owner.invariants;
    else if (mutation === "expression") i.expression = { op: "not", expression: i.expression };
    else if (mutation === "severity") i.severity = "Warning";
    else if (mutation === "message") i.message = "changed";
    else if (mutation === "shape") i.shape = `${EX}Other`;
    else must(owner.invariants).push(structuredClone(i));
    expect(() => assertFidelity(shapes, compiled)).toThrow(/invariant/);
  });
});

describe("diet semantics through generated runtime and SHACL", () => {
  it.each([
    [undefined, undefined, false],
    [false, undefined, false],
    [true, undefined, true],
    [true, "DQ2_5", false],
    [true, "DQ2_2", false],
    [true, "DQ8", false],
    [true, "DQ7", true],
  ])("coverage %s and present marker %s => %s", async (coverage, haplotype, valid) => {
    const result = generate();
    const e = must(defineModel(result.manifest).entities.Summary);
    const ds = new Store(
      new Parser().parse(`${H}<https://pod.test/doc> a diet:GeneticSummary;
      diet:consentGiven true; diet:coeliacGeneticRisk diet:riskHaplotypeAbsent
      ${coverage === undefined ? "" : `; diet:coverageComplete ${coverage}`}
      ${haplotype ? "; diet:hlaMarker <https://pod.test/doc#marker>" : ""}.
      ${haplotype ? `<https://pod.test/doc#marker> a diet:HlaMarker; diet:rsid "rs1"; diet:markerPresence diet:markerPresent; diet:riskHaplotype diet:${haplotype}.` : ""}`),
    );
    expect(e.parse("https://pod.test/doc", ds) !== undefined).toBe(valid);
    expect((await engine.validate(ds, must(result.artifacts["shapes.ttl"]))).conforms).toBe(valid);
  });
  it("allows incomplete coverage with a positive rollup and forbids overstated absence on builds/setters", () => {
    const e = must(defineModel(generate().manifest).entities.Summary);
    const data = {
      consentGiven: true,
      coverageComplete: false,
      coeliacGeneticRisk: `${EX}riskHaplotypePresent`,
    };
    const store = e.build("https://pod.test/doc", data);
    expect(e.parse("https://pod.test/doc", store)).toEqual(data);
    expect(() =>
      e.build("https://pod.test/doc", { ...data, coeliacGeneticRisk: `${EX}riskHaplotypeAbsent` }),
    ).toThrow(TypeError);
    const before = [...store];
    const w = new e.Wrapper("https://pod.test/doc", store, DataFactory) as unknown as {
      coeliacGeneticRisk: string;
    };
    expect(() => {
      w.coeliacGeneticRisk = `${EX}riskHaplotypeAbsent`;
    }).toThrow(TypeError);
    expect([...store]).toEqual(before);
  });
  it.each([
    false,
    true,
  ])("retains constraints in composite nodes, renames and generated lenses (class-only=%s)", (classOnly) => {
    const shapes = `${H}diet:Root a sh:NodeShape; sh:targetClass diet:GeneticSummary;
      sh:property [sh:path diet:hlaMarker; ${classOnly ? "sh:class diet:HlaMarker" : "sh:node diet:Marker"}; sh:maxCount 1; sh:minCount 1];
      sh:not [sh:not [sh:path diet:hlaMarker; sh:qualifiedMinCount 1; sh:qualifiedValueShape [sh:path diet:markerPresence; sh:hasValue true]]];
      sh:and ([sh:path diet:hlaMarker; sh:hasValue <https://pod.test/doc#marker>]).
      diet:Marker a sh:NodeShape; sh:targetClass diet:HlaMarker;
        sh:property [sh:path diet:markerPresence; sh:datatype xsd:boolean; sh:maxCount 1; sh:hasValue true].`;
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: {
            root: {
              targetClass: `${EX}GeneticSummary`,
              fragment: "it",
              links: { hlaMarker: "child" },
            },
            child: {
              targetClass: `${EX}HlaMarker`,
              fragment: "marker",
              fields: { markerPresence: { rename: "present" } },
            },
          },
        },
      ],
    };
    const vocab = `${H}diet:GeneticSummary a owl:Class; rdfs:label "s"; rdfs:comment "s". diet:HlaMarker a owl:Class; rdfs:label "m"; rdfs:comment "m".`;
    const result = generateModel({
      ontologyTtl: vocab,
      shapesTtl: shapes,
      config: cfg,
      admissionNamespace: EX,
    });
    const e = must(defineModel(result.manifest).entities.Tree);
    const store = e.build("https://pod.test/doc", { present: true });
    expect(e.parse("https://pod.test/doc", store)).toEqual({ present: true });
    const views = must(deriveNodeViews(result.manifest));
    const lens = must(
      defineModel(views.manifest, { migrationManifest: result.manifest }).entities.TreeChildNode,
    );
    const w = new lens.Wrapper("https://pod.test/doc#marker", store, DataFactory) as unknown as {
      present: boolean;
    };
    const before = [...store];
    expect(() => {
      w.present = false;
    }).toThrow(TypeError);
    expect([...store]).toEqual(before);
    const rootLens = must(
      defineModel(views.manifest, { migrationManifest: result.manifest }).entities.TreeRootNode,
    );
    const root = new rootLens.Wrapper("https://pod.test/doc#it", store, DataFactory) as unknown as {
      hlaMarker?: string;
    };
    expect(() => {
      root.hlaMarker = undefined;
    }).toThrow(TypeError);
    expect([...store]).toEqual(before);
    for (const quad of store.getQuads(
      "https://pod.test/doc#marker",
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      null,
      null,
    ))
      store.delete(quad);
    expect(e.parse("https://pod.test/doc", store) !== undefined).toBe(!classOnly);
    expect(isCompositeEntity(must(result.manifest.entities[0]))).toBe(true);
  });
});

describe("hasValue atoms on class-linked collections", () => {
  it("preserves and enforces the class before matching an exact member", () => {
    const result = generate(
      safety("sh:not [sh:not [sh:path diet:hlaMarker; sh:hasValue <https://pod.test/doc#marker>]]"),
    );
    const owner = flat(result.manifest.entities.find((e) => e.name === "Summary"));
    expect(owner.fields.find((f) => f.name === "hlaMarker")?.hasClass).toBe(`${EX}HlaMarker`);
    const e = must(defineModel(result.manifest).entities.Summary);
    for (const [type, valid] of [
      ["HlaMarker", true],
      ["Unknown", false],
    ] as const) {
      const store = new Store(
        new Parser().parse(`${H}<https://pod.test/doc> a diet:GeneticSummary; diet:consentGiven true; diet:hlaMarker <https://pod.test/doc#marker>.
        <https://pod.test/doc#marker> a diet:${type}; diet:rsid "rs1".`),
      );
      expect(e.parse("https://pod.test/doc", store) !== undefined).toBe(valid);
    }
  });
});
