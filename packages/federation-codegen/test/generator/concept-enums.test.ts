// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  AdmissionError,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  deriveNodeViews,
  emitShapesTtl,
  FidelityError,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
  serializeCanonicalTurtle,
} from "../../src/index.js";
import { RDF, SH } from "../../src/rdf.js";
import { flat } from "../helpers.js";

const EX = "https://example.org/concepts#";
const H = `@prefix ex: <${EX}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
const ontologyTtl = `${H}
ex:Summary a owl:Class; rdfs:label "Summary"; rdfs:comment "Summary" .
ex:Source a owl:Class; rdfs:label "Source"; rdfs:comment "Source" .
ex:source a owl:ObjectProperty; rdfs:label "source"; rdfs:comment "source";
  rdfs:domain ex:Summary; rdfs:range ex:Source .
ex:manual a ex:Source . ex:clinical a ex:Source .
[] a ex:Source . ex:Subclass rdfs:subClassOf ex:Source . ex:indirect a ex:Subclass .`;
const shapesTtl = `${H} ex:SummaryShape a sh:NodeShape; sh:targetClass ex:Summary;
  sh:property [ sh:path ex:source; sh:class ex:Source; sh:minCount 1; sh:maxCount 1 ] .`;
const config: CodegenConfig = {
  shapesBase: "https://example.org/concept-shapes#",
  prefixes: { ex: EX },
  entities: [{ name: "Summary", targetClass: `${EX}Summary`, subject: { convention: "self" } }],
};
const generate = (profile = shapesTtl, vocab = ontologyTtl, cfg = config) =>
  generateModel({ ontologyTtl: vocab, shapesTtl: profile, config: cfg, admissionNamespace: EX });
const normalize = (profile = shapesTtl) =>
  parseShapes(
    profile,
    config.shapesBase,
    owlRdfsAdapter.adapt(parseTurtle(ontologyTtl)),
    parseTurtle(ontologyTtl),
  );
const engine = createRdfEngine();
afterAll(() => engine.dispose());

describe("ontology concept IRI enumeration admission", () => {
  it("emits exactly the sorted direct named individuals and a literal-union type", () => {
    const result = generate();
    expect(result.admission.ok).toBe(true);
    expect(result.manifest.entities).toHaveLength(1);
    expect(flat(result.manifest.entities[0]).fields[0]).toMatchObject({
      kind: "iri",
      in: [`${EX}clinical`, `${EX}manual`],
      guards: { iriEnum: true, requiredFailClosed: true },
    });
    expect(result.artifacts["model.d.ts"]).toContain(`"source": "${EX}clinical" | "${EX}manual"`);
    const entity = defineModel(result.manifest).entities.Summary;
    expect(
      entity?.parse(
        "https://pod.test/doc",
        entity.build("https://pod.test/doc", { source: `${EX}manual` }),
      ),
    ).toEqual({ source: `${EX}manual` });
  });

  it("lowers concept classes to closed sh:in in emitted SHACL without requiring pod types", async () => {
    const result = generate();
    const emitted = result.artifacts["shapes.ttl"] as string;
    expect(emitted).not.toContain("sh:class");
    const data = (value: string) =>
      new Store(
        new Parser().parse(`${H}
      <https://pod.test/doc> a ex:Summary; ex:source ${value} .`),
      );
    expect((await engine.validate(data("ex:manual"), emitted)).conforms).toBe(true);
    for (const value of ["ex:outside", '"manual"', "[]"])
      expect((await engine.validate(data(value), emitted)).conforms).toBe(false);
  });

  it("intersects explicit sh:in with concepts and rejects an empty intersection", () => {
    const source = shapesTtl.replace(
      "sh:class ex:Source",
      "sh:class ex:Source; sh:in ( ex:manual ex:outside )",
    );
    expect(flat(generate(source).manifest.entities[0]).fields[0]?.in).toEqual([`${EX}manual`]);
    expect(() => generate(source.replace("ex:manual ex:outside", "ex:outside"))).toThrow(
      /enumeration/,
    );
  });

  it("removes the replaced sh:in list cells from emitted SHACL", () => {
    const profile = shapesTtl.replace(
      "sh:class ex:Source",
      "sh:class ex:Source; sh:in ( ex:manual ex:outside )",
    );
    const store = new Store(parseTurtle(generate(profile).artifacts["shapes.ttl"] as string));
    const heads = store.getQuads(null, `${SH}in`, null, null);
    expect(heads).toHaveLength(1);
    const head = heads[0]?.object;
    if (!head) throw new Error("missing concept enum list");
    expect(store.getQuads(null, `${RDF}first`, null, null)).toHaveLength(1);
    expect(store.getQuads(null, `${RDF}rest`, null, null)).toHaveLength(1);
    expect(store.getQuads(head, `${RDF}first`, null, null)[0]?.object.value).toBe(`${EX}manual`);
    expect(store.getQuads(head, `${RDF}rest`, null, null)[0]?.object.value).toBe(`${RDF}nil`);
    expect(store.getQuads(null, null, `${EX}outside`, null)).toHaveLength(0);
  });

  it.each(["head", "tail"])("preserves a replaced list's shared %s and its suffix", (shared) => {
    const profile = `${shapesTtl.replace(
      "sh:class ex:Source",
      "sh:class ex:Source; sh:in ex:oldHead",
    )}
      ex:oldHead <${RDF}first> ex:manual; <${RDF}rest> ex:oldTail .
      ex:oldTail <${RDF}first> ex:outside; <${RDF}rest> <${RDF}nil> .
      ex:SummaryShape sh:property ex:OtherProperty .
      ex:OtherProperty sh:path ex:other; sh:nodeKind sh:IRI;
        sh:in ${shared === "head" ? "ex:oldHead" : "ex:keptHead"} .
      ${shared === "tail" ? `ex:keptHead <${RDF}first> ex:clinical; <${RDF}rest> ex:oldTail .` : ""}`;
    const store = new Store(parseTurtle(generate(profile).artifacts["shapes.ttl"] as string));
    expect(store.getQuads(`${EX}oldHead`, null, null, null)).toHaveLength(
      shared === "head" ? 2 : 0,
    );
    expect(store.getQuads(`${EX}oldTail`, `${RDF}first`, `${EX}outside`, null)).toHaveLength(1);
    expect(store.getQuads(`${EX}oldTail`, `${RDF}rest`, `${RDF}nil`, null)).toHaveLength(1);
  });

  it("keeps Warning concept enums strict in the runtime while emitting Warning sh:in", () => {
    const result = generate(
      shapesTtl.replace("sh:class ex:Source", "sh:class ex:Source; sh:severity sh:Warning"),
    );
    const field = flat(result.manifest.entities[0]).fields[0];
    expect(field?.guards?.iriEnum).toBe(true);
    expect(field?.guards?.requiredFailClosed).toBeUndefined();
    const store = new Store(parseTurtle(result.artifacts["shapes.ttl"] as string));
    const property = store.getQuads(null, `${SH}in`, null, null)[0]?.subject;
    if (!property) throw new Error("missing concept property shape");
    expect(store.getQuads(property, `${SH}severity`, `${SH}Warning`, null)).toHaveLength(1);
    expect(store.getQuads(property, `${SH}class`, null, null)).toHaveLength(0);
    const entity = defineModel(result.manifest).entities.Summary;
    if (!entity) throw new Error("missing Summary");
    expect(() => entity.build("https://pod.test/doc", { source: `${EX}outside` })).toThrow(
      TypeError,
    );
    const data = new Store(
      new Parser().parse(`${H}
      <https://pod.test/doc> a ex:Summary; ex:source ex:outside .`),
    );
    expect(entity.parse("https://pod.test/doc", data)).toEqual({});
    expect(
      entity.parse(
        "https://pod.test/doc",
        entity.build("https://pod.test/doc", { source: `${EX}manual` }),
      ),
    ).toEqual({ source: `${EX}manual` });
  });

  it.each([
    "",
    "[] a ex:Source .",
  ])("does not invent an enum when no named individuals exist: %s", (members) => {
    const vocab = ontologyTtl
      .replace("ex:manual a ex:Source . ex:clinical a ex:Source .", "")
      .replace("[] a ex:Source .", members);
    expect(() => generate(shapesTtl, vocab)).toThrow(AdmissionError);
  });

  describe("a Warning-graded concept sh:class never silently loses enforcement", () => {
    const warning = shapesTtl.replace(
      "sh:class ex:Source",
      "sh:class ex:Source; sh:severity sh:Warning",
    );
    const withSourceEntity: CodegenConfig = {
      ...config,
      entities: [
        ...config.entities,
        { name: "Source", targetClass: `${EX}Source`, subject: { convention: "self" } },
      ],
    };
    const sourceShape = "\nex:SourceShape a sh:NodeShape; sh:targetClass ex:Source .";
    const noNamed = ontologyTtl.replace("ex:manual a ex:Source . ex:clinical a ex:Source .", "");

    it("rejects projecting a class that still has named individuals", () => {
      expect(() => generate(`${warning}${sourceShape}`, ontologyTtl, withSourceEntity)).toThrow(
        /unstable-concept-enum.*projected class that has named ontology individuals/,
      );
      // A config entry alone also projects the class.
      expect(() => generate(warning, ontologyTtl, withSourceEntity)).toThrow(
        /unstable-concept-enum/,
      );
    });

    it("rejects removing the last named individual against the committed manifest", () => {
      // In the admission namespace, the now-unlowered concept class already fails
      // NodeShape coverage. An external concept class (outside the admission namespace)
      // has no such backstop, so the committed manifest pins its strictness.
      expect(() => generate(warning, noNamed)).toThrow(/missing-shape/);
      const external = (vocab: string, previousManifest?: string) =>
        generateModel({
          ontologyTtl: vocab,
          shapesTtl: warning,
          config,
          admissionNamespace: "https://example.org/elsewhere#",
          ...(previousManifest === undefined ? {} : { previousManifest }),
        });
      const committed = external(ontologyTtl).artifacts["model.json"] as string;
      expect(() => external(noNamed, committed)).toThrow(
        /unstable-concept-enum\] Summary https:\/\/example.org\/concepts#source: field was a closed concept enumeration/,
      );
      expect(() => external(noNamed, "{")).toThrow(/not a readable manifest/);
      // Unchanged strictness passes; removing the committed manifest is the explicit
      // opt-in to the loosening (a first generation has nothing to compare against).
      expect(external(ontologyTtl, committed).artifacts["model.json"]).toBe(committed);
      const fresh = external(noNamed);
      expect(fresh.admission.ok).toBe(true);
      expect(flat(fresh.manifest.entities[0]).fields[0]?.in).toBeUndefined();
    });

    it("keeps the documented advisory omission for a projected class without individuals", () => {
      const result = generate(`${warning}${sourceShape}`, noNamed, withSourceEntity);
      expect(result.admission.ok).toBe(true);
      expect(result.admission.violations.some((v) => v.message.includes("advisory"))).toBe(true);
      const summary = result.manifest.entities.find((e) => e.name === "Summary");
      expect(flat(summary).fields.find((f) => f.name === "source")?.in).toBeUndefined();
    });
  });

  describe("concept members excluded by the property's http(s) pattern", () => {
    it.each([
      ['"^https?://"', "<urn:x:a> a ex:Source ."],
      ['"^https://"', "<http://example.org/plain> a ex:Source ."],
    ])("rejects %s with %s at generation time", (pattern, member) => {
      expect(() =>
        generate(
          shapesTtl.replace("sh:class ex:Source", `sh:class ex:Source; sh:pattern ${pattern}`),
          `${ontologyTtl} ${member}`,
        ),
      ).toThrow(/concept-enum-scheme-conflict/);
    });

    it("admits the enum when an explicit sh:in removes the excluded member", () => {
      const result = generate(
        shapesTtl.replace(
          "sh:class ex:Source",
          'sh:class ex:Source; sh:pattern "^https?://"; sh:in ( ex:manual )',
        ),
        `${ontologyTtl} <urn:x:a> a ex:Source .`,
      );
      expect(flat(result.manifest.entities[0]).fields[0]).toMatchObject({
        in: [`${EX}manual`],
        guards: { iriEnum: true, iriScheme: "http-https" },
      });
    });
  });

  it("keeps projected entity classes as links even if the ontology contains individuals", () => {
    const profile = `${shapesTtl}\nex:SourceShape a sh:NodeShape; sh:targetClass ex:Source .`;
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "summary",
          nodes: {
            summary: { targetClass: `${EX}Summary`, fragment: "it", links: { source: "source" } },
            source: { targetClass: `${EX}Source`, fragment: "source", fields: {} },
          },
        },
      ],
    };
    const e = generate(profile, ontologyTtl, cfg).manifest.entities[0];
    if (e?.kind !== "composite") throw new Error("missing composite");
    expect(e.nodes[0]?.fields[0]).toMatchObject({
      kind: "nested",
      hasClass: `${EX}Source`,
      classOnly: true,
    });
    expect(e.nodes[0]?.fields[0]?.in).toBeUndefined();
    expect(() =>
      generate(profile, ontologyTtl, {
        ...config,
        entities: [
          ...config.entities,
          { name: "Source", targetClass: `${EX}Source`, subject: { convention: "self" } },
        ],
      }),
    ).toThrow(/class conformance/);
  });

  it("does not treat an explicit sh:node or composite-link configuration as a concept enum", () => {
    expect(() =>
      generate(
        shapesTtl.replace("sh:class ex:Source", "sh:class ex:Source; sh:node ex:MissingShape"),
      ),
    ).toThrow(AdmissionError);
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "summary",
          nodes: {
            summary: { targetClass: `${EX}Summary`, fragment: "it", links: { source: "summary" } },
          },
        },
      ],
    };
    expect(() => generate(shapesTtl, ontologyTtl, cfg)).toThrow(AdmissionError);
  });

  it("resolves link semantics after merging class, field name and node constraints", () => {
    const vocab = `${ontologyTtl} ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child";
      rdfs:subClassOf ex:Source .`;
    const profile = `${shapesTtl} ex:ExtraShape a sh:NodeShape; sh:targetClass ex:Summary;
      sh:property [ sh:path ex:source; sh:name "child"; sh:node ex:ChildShape; sh:maxCount 1 ] .
      ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child .`;
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: {
            root: { targetClass: `${EX}Summary`, fragment: "it", links: { child: "child" } },
            child: { targetClass: `${EX}Child`, fragment: "child", fields: {} },
          },
        },
      ],
    };
    // Source remains an unprojected superclass, not a concept coverage exemption.
    const externalVocab = vocab.replaceAll("ex:Source", "<urn:Source>");
    const externalProfile = profile.replaceAll("ex:Source", "<urn:Source>");
    const result = generate(externalProfile, externalVocab, cfg);
    const e = result.manifest.entities[0];
    if (e?.kind !== "composite") throw new Error("missing Tree");
    expect(e.nodes[0]?.fields[0]).toMatchObject({ kind: "nested", hasClass: "urn:Source" });
    expect(result.artifacts["shapes.ttl"]).toContain("sh:class <urn:Source>");
    expect(result.artifacts["shapes.ttl"]).not.toContain("concept-enum-");
  });

  it("never lowers a reusable property shape that another owner uses as a merged link", () => {
    const vocab = `${ontologyTtl}
      ex:Other a owl:Class; rdfs:label "Other"; rdfs:comment "Other" .
      ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child"; rdfs:subClassOf ex:Source .`.replaceAll(
      "ex:Source",
      "<urn:Source>",
    );
    const profile = `${H}
      ex:Shared sh:path ex:source; sh:class <urn:Source>; sh:maxCount 1 .
      ex:SummaryShape a sh:NodeShape; sh:targetClass ex:Summary; sh:property ex:Shared .
      ex:ExtraShape a sh:NodeShape; sh:targetClass ex:Summary;
        sh:property [ sh:path ex:source; sh:node ex:ChildShape ] .
      ex:OtherShape a sh:NodeShape; sh:targetClass ex:Other; sh:property ex:Shared .
      ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child .`;
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: {
            root: { targetClass: `${EX}Summary`, fragment: "it", links: { source: "child" } },
            child: { targetClass: `${EX}Child`, fragment: "child", fields: {} },
          },
        },
        { name: "Other", targetClass: `${EX}Other`, subject: { convention: "self" } },
      ],
    };
    expect(() => generate(profile, vocab, cfg)).toThrow(/reserved for runtime structure/);
    const shapes = parseShapes(
      profile,
      cfg.shapesBase,
      owlRdfsAdapter.adapt(parseTurtle(vocab)),
      parseTurtle(vocab),
      cfg,
    );
    expect(
      shapes.nodeShapes.find((s) => s.targetClass === `${EX}Other`)?.properties[0]?.conceptIris,
    ).toBeUndefined();
    expect(emitShapesTtl(shapes, {})).not.toContain("concept-enum-");
  });

  it("supports concept enum fields in composites and their derived node views", () => {
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: { root: { targetClass: `${EX}Summary`, fragment: "it", fields: { source: {} } } },
        },
      ],
    };
    const result = generate(shapesTtl, ontologyTtl, cfg);
    const views = deriveNodeViews(result.manifest);
    expect(flat(views?.manifest.entities[0]).fields[0]?.guards?.iriEnum).toBe(true);
  });

  it.each([
    true,
    false,
  ])("enforces concept membership inside a strict child shape (required link=%s)", (required) => {
    const vocab = `${ontologyTtl} ex:Root a owl:Class; rdfs:label "Root"; rdfs:comment "Root" .`;
    const profile = `${shapesTtl} ex:RootShape a sh:NodeShape; sh:targetClass ex:Root; sh:property [
      sh:path ex:child; sh:node ex:SummaryShape; sh:maxCount 1; sh:minCount ${required ? 1 : 0} ] .`;
    const cfg: CodegenConfig = {
      ...config,
      entities: [
        {
          name: "Tree",
          kind: "composite",
          root: "root",
          nodes: {
            root: { targetClass: `${EX}Root`, fragment: "it", links: { child: "summary" } },
            summary: { targetClass: `${EX}Summary`, fragment: "summary", fields: { source: {} } },
          },
        },
      ],
    };
    const result = generate(profile, vocab, cfg);
    const e = defineModel(result.manifest).entities.Tree;
    if (!e) throw new Error("missing Tree");
    expect(
      e.parse("https://pod.test/doc", e.build("https://pod.test/doc", { source: `${EX}manual` })),
    ).toEqual({ source: `${EX}manual` });
    const ds = new Store(
      new Parser().parse(`${H}<https://pod.test/doc#it> a ex:Root; ex:child <https://pod.test/child> .
      <https://pod.test/child> ex:source ex:outside .`),
    );
    expect(e.parse("https://pod.test/doc", ds)).toEqual(required ? undefined : {});
    const shapes = parseShapes(
      profile,
      cfg.shapesBase,
      owlRdfsAdapter.adapt(parseTurtle(vocab)),
      parseTurtle(vocab),
      cfg,
    );
    const compiled = compileManifest(shapes, cfg);
    const tree = compiled.manifest.entities[0];
    if (tree?.kind !== "composite") throw new Error("missing Tree");
    const source = tree.nodes.find((n) => n.name === "summary")?.fields[0];
    if (!source?.guards) throw new Error("missing concept field");
    delete source.guards.iriEnum;
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });

  it.each(["drop", "add", "reorder", "guard"])("fidelity rejects enum %s tampering", (change) => {
    const shapes = normalize();
    const compiled = compileManifest(shapes, config);
    const field = flat(compiled.manifest.entities[0]).fields[0];
    if (!field?.in || !field.guards) throw new Error("missing enum");
    if (change === "drop") field.in.pop();
    if (change === "add") field.in.push(`${EX}outside`);
    if (change === "reorder") field.in.reverse();
    if (change === "guard") delete field.guards.iriEnum;
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });

  it("is deterministic under ontology/profile permutations and blank-node relabelling", () => {
    const permute = (ttl: string) =>
      serializeCanonicalTurtle(parseTurtle(ttl).reverse(), {}, "N-Triples");
    const original = generate();
    const reversed = generate(permute(shapesTtl), permute(ontologyTtl));
    for (const name of ["model.json", "model.js", "model.d.ts", "shapes.ttl"])
      expect(reversed.artifacts[name], name).toBe(original.artifacts[name]);
  });

  it("rejects unsafe concept identities and contradictory literal constraints", () => {
    expect(() =>
      generate(shapesTtl, `${ontologyTtl} <https://example.org/a|b> a ex:Source .`),
    ).toThrow();
    expect(() =>
      generate(
        shapesTtl.replace("sh:class ex:Source", "sh:class ex:Source; sh:nodeKind sh:Literal"),
      ),
    ).toThrow(AdmissionError);
  });

  it("detects collisions with minted concept-list identities", () => {
    const shapes = normalize();
    const emitted = parseTurtle(emitShapesTtl(shapes, {}));
    const cell = emitted.find((q) => q.predicate.value.endsWith("#first"))?.subject.value;
    if (!cell) throw new Error("missing enum list");
    expect(() => generate(`${shapesTtl}\n<${cell}> <urn:p> <urn:o> .`)).toThrow(/collision/);
  });

  it("the actual diet safety shapes still fail admission on sh:not after class grouping", () => {
    const profile = readFileSync(
      new URL("../../../solid-health-diary/shapes/diet.shacl.ttl", import.meta.url),
      "utf8",
    );
    const vocab = readFileSync(
      new URL("../../../solid-health-diary/shapes/diet.vocab.ttl", import.meta.url),
      "utf8",
    );
    try {
      generateModel({
        shapesTtl: profile,
        ontologyTtl: vocab,
        config,
        admissionNamespace: "https://jeswr.org/ns/sectors/health/diet#",
      });
      throw new Error("unexpected admission");
    } catch (error) {
      expect(error).toBeInstanceOf(AdmissionError);
      const errors = (error as AdmissionError).violations;
      for (const name of ["GeneticRiskCoverageShape", "GeneticRiskMarkerConsistencyShape"])
        expect(
          errors.some((v) => v.subject.endsWith(name) && v.message.includes("shacl#not")),
        ).toBe(true);
    }
  });
});
