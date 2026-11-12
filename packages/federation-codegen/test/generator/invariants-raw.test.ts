// AUTHORED-BY Claude Opus 5.5
// Regression tests for the adversarial review of PR #565: invariant atoms are evaluated with
// SHACL semantics over the RAW data graph, so the generated runtime agrees with an external
// SHACL validator of the emitted shapes.ttl and negated safety rules fail closed.
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import { AdmissionError, type CodegenConfig, generateModel } from "../../src/index.js";
import {
  baseShapes,
  config,
  EX,
  H,
  ontologyTtl,
  safetyShapes,
} from "../fixtures/diet-invariants.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture value");
  return value;
}
const URL = "https://pod.test/g";
const result = generateModel({
  ontologyTtl,
  shapesTtl: baseShapes + safetyShapes,
  config,
  admissionNamespace: EX,
});
const model = defineModel(result.manifest);
const Summary = must(model.entities.Summary);
const Marker = must(model.entities.Marker);
const doc = (body: string) => new Store(new Parser().parse(`${H} ${body}`));
const summary = (extra: string, iri = URL) =>
  `<${iri}> a diet:GeneticSummary; diet:consentGiven true; ${extra} .`;
const absentComplete = (markers: string) =>
  summary(
    `diet:coeliacGeneticRisk diet:riskHaplotypeAbsent; diet:coverageComplete true; diet:hlaMarker ${markers}`,
  );
const marker = (subject: string, presence: string, haplotype: string, extra = "") =>
  `${subject} a diet:HlaMarker; diet:rsid "rs1"; diet:markerPresence diet:${presence}; diet:riskHaplotype diet:${haplotype} ${extra}.`;
const engine = createRdfEngine();
afterAll(() => engine.dispose());

describe("diet safety invariants on adversarial pod data (runtime agrees with SHACL)", () => {
  const m0 = `<${URL}#m0>`;
  it.each([
    ["absent without coverage", summary("diet:coeliacGeneticRisk diet:riskHaplotypeAbsent"), false],
    [
      "absent with coverage false",
      summary("diet:coeliacGeneticRisk diet:riskHaplotypeAbsent; diet:coverageComplete false"),
      false,
    ],
    [
      'absent with non-canonical coverage "1"',
      summary(
        'diet:coeliacGeneticRisk diet:riskHaplotypeAbsent; diet:coverageComplete "1"^^xsd:boolean',
      ),
      false,
    ],
    // finding 2: risk dropped by maxCount must still trip the coverage rule
    [
      "two risk values (absent + present) without coverage",
      summary("diet:coeliacGeneticRisk diet:riskHaplotypeAbsent, diet:riskHaplotypePresent"),
      false,
    ],
    ["DQ2_5 present", absentComplete(m0) + marker(m0, "markerPresent", "DQ2_5"), false],
    ["DQ8 present", absentComplete(m0) + marker(m0, "markerPresent", "DQ8"), false],
    ["DQ7 present", absentComplete(m0) + marker(m0, "markerPresent", "DQ7"), true],
    ["DQ2_5 absent", absentComplete(m0) + marker(m0, "markerAbsent", "DQ2_5"), true],
    [
      "no markers",
      summary("diet:coeliacGeneticRisk diet:riskHaplotypeAbsent; diet:coverageComplete true"),
      true,
    ],
    // finding 1: non-http(s) linked IRIs count
    [
      "urn marker with DQ2_5 present",
      absentComplete("<urn:x:m>") + marker("<urn:x:m>", "markerPresent", "DQ2_5"),
      false,
    ],
    // finding 2: atoms on values a reader would drop
    [
      "DQ2_5 present marker failing its own parse (two rsids)",
      absentComplete(m0) + marker(m0, "markerPresent", "DQ2_5", '; diet:rsid "rsX"'),
      false,
    ],
    [
      "present marker with DQ7 + DQ2_5 (maxCount dropped)",
      absentComplete(m0) + marker(m0, "markerPresent", "DQ7", "; diet:riskHaplotype diet:DQ2_5"),
      false,
    ],
    [
      "untyped DQ2_5 present marker",
      `${absentComplete(m0)} ${m0} diet:rsid "r"; diet:markerPresence diet:markerPresent; diet:riskHaplotype diet:DQ2_5.`,
      false,
    ],
    [
      "markerPresence both present and absent",
      absentComplete(m0) +
        marker(m0, "markerPresent", "DQ2_5", "; diet:markerPresence diet:markerAbsent"),
      false,
    ],
    [
      "blank-node DQ2_5 present marker",
      absentComplete("_:b") + marker("_:b", "markerPresent", "DQ2_5"),
      false,
    ],
  ])("%s => accepted=%s", async (_label, ttl, valid) => {
    const store = doc(ttl);
    expect(Summary.parse(URL, store) !== undefined).toBe(valid);
    // Runtime acceptance coincides with the safety shapes' verdict (other base-shape
    // results, e.g. a malformed marker's own rsid, are not part of this comparison).
    const report = await engine.validate(store, must(result.artifacts["shapes.ttl"]));
    // Both safety shapes are node-level sh:not; no other shape uses sh:not here.
    const safety = report.results.filter(
      (r) =>
        r.focusNode === `<${URL}>` &&
        r.sourceConstraintComponent === "http://www.w3.org/ns/shacl#NotConstraintComponent",
    );
    expect(safety.length === 0).toBe(valid);
  });

  it("accepts a valid summary with 1,000 markers within the budget (linear evaluation)", () => {
    const n = 1000;
    const links = Array.from({ length: n }, (_, i) => `<${URL}#m${i}>`).join(", ");
    const markers = Array.from({ length: n }, (_, i) =>
      marker(`<${URL}#m${i}>`, "markerPresent", "DQ7"),
    ).join("\n");
    expect(Summary.parse(URL, doc(absentComplete(links) + markers))?.hlaMarker).toHaveLength(n);
  });
});

describe("diet writes validate only the focuses they affect", () => {
  it("a valid summary write succeeds next to an invalid sibling summary", () => {
    const store = doc(`${summary("diet:coverageComplete true")}
      ${summary("diet:coeliacGeneticRisk diet:riskHaplotypeAbsent", `${URL}2`)}`);
    expect(Summary.parse(`${URL}2`, store)).toBeUndefined();
    (
      new Summary.Wrapper(URL, store, DataFactory) as unknown as { coverageComplete: boolean }
    ).coverageComplete = false;
    expect(Summary.parse(URL, store)?.coverageComplete).toBe(false);
  });
  it("a write succeeds next to a sibling missing its fixed consent value", () => {
    const store = doc(`${summary("diet:coverageComplete false")} <${URL}2> a diet:GeneticSummary.`);
    (
      new Summary.Wrapper(URL, store, DataFactory) as unknown as { coverageComplete: boolean }
    ).coverageComplete = true;
    expect(Summary.parse(URL, store)?.coverageComplete).toBe(true);
  });
  it("a marker write succeeds next to an invalid unrelated summary", () => {
    const store = doc(`${summary("diet:coeliacGeneticRisk diet:riskHaplotypeAbsent", `${URL}2`)}
      <${URL}#m> a diet:HlaMarker; diet:rsid "a".`);
    (new Marker.Wrapper(`${URL}#m`, store, DataFactory) as unknown as { rsid: string }).rsid = "b";
    expect(Marker.parse(`${URL}#m`, store)?.rsid).toBe("b");
  });
  it("a marker write that flips its own owner's invariant throws before mutation", () => {
    const m0 = `<${URL}#m0>`;
    const store = doc(absentComplete(m0) + marker(m0, "markerPresent", "DQ7"));
    const before = [...store].map((q) => JSON.stringify(q)).sort();
    const w = new Marker.Wrapper(`${URL}#m0`, store, DataFactory) as unknown as {
      riskHaplotype: string;
    };
    expect(() => {
      w.riskHaplotype = `${EX}DQ2_5`;
    }).toThrow(/MarkerSafety/);
    expect([...store].map((q) => JSON.stringify(q)).sort()).toEqual(before);
    expect(Summary.parse(URL, store)).toBeDefined();
  });
  it("a marker write next to 500 linked markers is not failed by invariant validation", () => {
    const n = 500;
    const links = Array.from({ length: n }, (_, i) => `<${URL}#m${i}>`).join(", ");
    const markers = Array.from({ length: n }, (_, i) =>
      marker(`<${URL}#m${i}>`, "markerAbsent", "DQ7"),
    ).join("\n");
    const store = doc(absentComplete(links) + markers);
    (new Marker.Wrapper(`${URL}#m1`, store, DataFactory) as unknown as { rsid: string }).rsid =
      "zz";
    expect(Marker.parse(`${URL}#m1`, store)?.rsid).toBe("zz");
  });
});

describe("closed admission of logical operands (review probe p4)", () => {
  const atom = "[ sh:path diet:coverageComplete; sh:hasValue true ]";
  const markerAtom = '[ sh:path diet:rsid; sh:hasValue "x" ]';
  const gen = (shapesTtl: string) =>
    generateModel({ ontologyTtl, shapesTtl, config, admissionNamespace: EX });
  const extra = (ttl: string) => `${baseShapes} ${ttl}`;
  it.each([
    ["node-level sh:hasValue", extra("diet:SummaryShape sh:hasValue diet:x.")],
    [
      "property-level sh:not",
      baseShapes.replace(
        "sh:path diet:coverageComplete; sh:datatype xsd:boolean; sh:maxCount 1",
        `sh:path diet:coverageComplete; sh:datatype xsd:boolean; sh:maxCount 1; sh:not ${atom}`,
      ),
    ],
    [
      "property-level qualified shape",
      baseShapes.replace(
        "sh:path diet:hlaMarker; sh:class diet:HlaMarker;",
        `sh:path diet:hlaMarker; sh:class diet:HlaMarker; sh:qualifiedMinCount 1; sh:qualifiedValueShape ${markerAtom};`,
      ),
    ],
    [
      "typed named operand",
      extra(
        "diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:not diet:A. diet:A a sh:PropertyShape; sh:path diet:coverageComplete; sh:hasValue true.",
      ),
    ],
    [
      "sh:deactivated",
      extra(
        `diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:deactivated true; sh:not ${atom}.`,
      ),
    ],
    [
      "qualified over a single class link",
      extra(
        `diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:not [ sh:path diet:coeliacGeneticRisk; sh:qualifiedMinCount 1; sh:qualifiedValueShape ${atom} ].`,
      ),
    ],
    [
      "two messages",
      extra(
        `diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:message "a"@en, "b"@fr; sh:not ${atom}.`,
      ),
    ],
    [
      "non-xsd:integer qualified minimum",
      extra(
        `diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:not [ sh:path diet:hlaMarker; sh:qualifiedMinCount "1"^^xsd:int; sh:qualifiedValueShape ${markerAtom} ].`,
      ),
    ],
    [
      "qualified over a literal path",
      extra(
        `diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:not [ sh:path diet:hlaMarker; sh:qualifiedMinCount 1; sh:qualifiedValueShape [ sh:path diet:rsid; sh:qualifiedMinCount 1; sh:qualifiedValueShape ${markerAtom} ] ].`,
      ),
    ],
    [
      "non-canonical integer hasValue",
      baseShapes.replace(
        "sh:datatype xsd:boolean; sh:maxCount 1; sh:hasValue true",
        'sh:datatype xsd:integer; sh:maxCount 1; sh:hasValue "01"^^xsd:integer',
      ),
    ],
    [
      "non-canonical decimal hasValue",
      baseShapes.replace(
        "sh:datatype xsd:boolean; sh:maxCount 1; sh:hasValue true",
        "sh:datatype xsd:decimal; sh:maxCount 1; sh:hasValue 1.50",
      ),
    ],
    [
      "sh:closed beside a logical constraint",
      extra(
        `diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:not ${atom}; sh:closed true.`,
      ),
    ],
  ])("rejects %s", (_label, ttl) => {
    expect(() => gen(ttl)).toThrow(AdmissionError);
  });
  it.each([
    [
      "an untyped named atom operand",
      extra(
        "diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:not diet:A. diet:A sh:path diet:coverageComplete; sh:hasValue true.",
      ),
    ],
    [
      "hasValue on a class-linked collection",
      extra(
        "diet:S2 a sh:NodeShape; sh:targetClass diet:GeneticSummary; sh:not [ sh:path diet:hlaMarker; sh:hasValue <https://x.example/m> ].",
      ),
    ],
  ])("admits %s", (_label, ttl) => {
    const summaryEntity = gen(ttl).manifest.entities.find((e) => e.name === "Summary");
    expect(summaryEntity && "invariants" in summaryEntity && summaryEntity.invariants).toHaveLength(
      1,
    );
  });
});

describe("an optional composite link cannot hide a child that SHACL rejects (review finding 1)", () => {
  const D = "https://pod.test/doc";
  /** Root --hlaMarker (optional)--> Marker child, linked by sh:node or class-only sh:class. */
  const tree = (classOnly: boolean, child: "invariant" | "fixed") => {
    const presence =
      child === "fixed"
        ? "sh:property [sh:path diet:markerPresence; sh:datatype xsd:boolean; sh:maxCount 1; sh:hasValue true]"
        : "sh:property [sh:path diet:markerPresence; sh:datatype xsd:boolean; sh:maxCount 1]; sh:not [sh:path diet:markerPresence; sh:hasValue true]";
    const shapes = `${H}diet:Root a sh:NodeShape; sh:targetClass diet:GeneticSummary;
      sh:property [sh:path diet:hlaMarker; ${classOnly ? "sh:class diet:HlaMarker" : "sh:node diet:Marker"}; sh:maxCount 1].
      diet:Marker a sh:NodeShape; sh:targetClass diet:HlaMarker; ${presence}.`;
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
              fields: { markerPresence: {} },
            },
          },
        },
      ],
    };
    const vocab = `${H}diet:GeneticSummary a owl:Class; rdfs:label "s"; rdfs:comment "s". diet:HlaMarker a owl:Class; rdfs:label "m"; rdfs:comment "m".`;
    return generateModel({
      ontologyTtl: vocab,
      shapesTtl: shapes,
      config: cfg,
      admissionNamespace: EX,
    });
  };
  const root = `<${D}#it> a diet:GeneticSummary`;
  const typed = (node: string, presence: boolean) =>
    `${node} a diet:HlaMarker; diet:markerPresence ${presence}.`;
  it.each([
    [false, "invariant"],
    [true, "invariant"],
    [false, "fixed"],
    [true, "fixed"],
  ] as const)("runtime parse agrees with SHACL (class-only=%s, %s)", async (classOnly, child) => {
    const result = tree(classOnly, child);
    const Tree = must(defineModel(result.manifest).entities.Tree);
    // The invariant forbids presence=true; the fixed value requires it.
    const bad = child === "invariant";
    const m = `<${D}#marker>`;
    for (const [label, ttl, valid] of [
      ["violating child", `${root}; diet:hlaMarker ${m}. ${typed(m, bad)}`, false],
      ["conforming child", `${root}; diet:hlaMarker ${m}. ${typed(m, !bad)}`, true],
      ["no link", `${root}. ${typed(m, !bad)}`, true],
      [
        "violating second value node",
        `${root}; diet:hlaMarker ${m}, <${D}#m2>. ${typed(m, !bad)} ${typed(`<${D}#m2>`, bad)}`,
        false,
      ],
    ] as const) {
      const store = doc(ttl);
      const parsed = Tree.parse(D, store);
      expect(parsed !== undefined, label).toBe(valid);
      if (valid) expect(parsed?.markerPresence, label).toBe(label === "no link" ? undefined : !bad);
      const report = await engine.validate(store, must(result.artifacts["shapes.ttl"]));
      expect(report.conforms, label).toBe(valid);
    }
  });
  it("review probe: R -> C with C not(hasValue(flag, true)) and flag true does not parse", () => {
    for (const classOnly of [false, true]) {
      const Tree = must(defineModel(tree(classOnly, "invariant").manifest).entities.Tree);
      const store = doc(`${root}; diet:hlaMarker <${D}#marker>. ${typed(`<${D}#marker>`, true)}`);
      expect(Tree.parse(D, store), `class-only=${classOnly}`).toBeUndefined();
    }
  });
});
