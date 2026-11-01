// AUTHORED-BY Codex GPT-6
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  emitShapesTtl,
  generateModel,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture member");
  return value;
}

const EX = "https://ex.test/";
const DOC = `${EX}doc`;
const H = `@prefix ex: <${EX}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const store = (body: string) => new Store(new Parser().parse(`${H} ${body}`));
const engine = createRdfEngine();
afterAll(() => engine.dispose());
const ontology = `${H}
ex:Root a owl:Class; rdfs:label "Root"; rdfs:comment "Root" .
ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child"; rdfs:subClassOf ex:Base .
ex:link a owl:ObjectProperty; rdfs:label "link"; rdfs:comment "link"; rdfs:domain ex:Root; rdfs:range ex:Child .
ex:title a owl:DatatypeProperty; rdfs:label "title"; rdfs:comment "title"; rdfs:domain ex:Child; rdfs:range xsd:string .`;
const config = (): CodegenConfig => ({
  shapesBase: `${EX}shapes/`,
  prefixes: {},
  entities: [
    {
      name: "Tree",
      kind: "composite",
      root: "root",
      nodes: {
        root: { targetClass: `${EX}Root`, fragment: "it", links: { link: "child" } },
        child: { targetClass: `${EX}Child`, fragment: "child", fields: { title: {}, keep: {} } },
      },
    },
  ],
});
const profile = (constraint: string, required = true, link = "sh:node ex:ChildShape;") => `${H}
ex:RootShape a sh:NodeShape; sh:targetClass ex:Root;
 sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI; ${link}
 ${required ? "sh:minCount 1;" : ""} sh:maxCount 1 ] .
ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child;
 sh:property [ sh:path ex:title; sh:name "title"; ${constraint} ];
 sh:property [ sh:path ex:keep; sh:name "keep"; sh:datatype xsd:string; sh:maxCount 1 ] .`;
const generate = (source: string, cfg = config()) =>
  generateModel({
    ontologyTtl: ontology,
    shapesTtl: source,
    config: cfg,
    admissionNamespace: EX,
  });
async function crossCheck(
  ds: Store,
  source: string,
  emitted: string | undefined,
  conforms: boolean,
) {
  if (!emitted) throw new Error("missing profile");
  for (const shapes of [source, emitted])
    expect((await engine.validate(ds, shapes)).conforms).toBe(conforms);
}

describe("R10 M1: nested sh:node checks present optional constraints", () => {
  for (const required of [true, false]) {
    it.each([
      ["datatype", "sh:datatype xsd:string; sh:maxCount 1", "1"],
      ["cardinality", "sh:datatype xsd:string; sh:maxCount 1", '"one", "two"'],
      ["enum", 'sh:datatype xsd:string; sh:in ( "valid" ); sh:maxCount 1', '"bad"'],
      ["pattern", 'sh:datatype xsd:string; sh:pattern "\\\\S"; sh:maxCount 1', '" "'],
      ["length", "sh:datatype xsd:string; sh:minLength 3; sh:maxCount 1", '"x"'],
      ["node kind", "sh:nodeKind sh:IRI; sh:maxCount 1", '"literal"'],
      ["set member", "sh:datatype xsd:string; sh:maxCount 3", '"valid", 1'],
    ])(`rejects/degrades present %s violations (required=${required})`, async (_name, constraint, value) => {
      const source = profile(constraint as string, required);
      const result = generate(source);
      for (const typed of [true, false]) {
        const ds = store(
          `<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ${typed ? "a ex:Child;" : ""} ex:title ${value}; ex:keep "kept" .`,
        );
        await crossCheck(ds, source, result.artifacts["shapes.ttl"], false);
        expect(defineModel(result.manifest).entities.Tree?.parse(DOC, ds)).toEqual(
          required ? undefined : {},
        );
      }
    });
  }
  it("keeps absent optional values and valid present values", async () => {
    const source = profile("sh:datatype xsd:string; sh:maxCount 1");
    const result = generate(source);
    for (const value of ["", 'ex:child ex:title "valid" .']) {
      const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child . ${value}`);
      await crossCheck(ds, source, result.artifacts["shapes.ttl"], true);
      expect(defineModel(result.manifest).entities.Tree?.parse(DOC, ds)).toEqual(
        value ? { title: "valid" } : {},
      );
    }
  });
  it.each([
    true,
    false,
  ])("propagates a present optional class violation inside sh:node (required=%s)", async (required) => {
    const source = profile("sh:datatype xsd:string; sh:maxCount 1", required)
      .replace(
        "sh:property [ sh:path ex:title;",
        'sh:property [ sh:path ex:next; sh:name "next"; sh:nodeKind sh:IRI; sh:class ex:Leaf; sh:maxCount 1 ]; sh:property [ sh:path ex:title;',
      )
      .concat("\nex:LeafShape a sh:NodeShape; sh:targetClass ex:Leaf .");
    const cfg = config();
    const composite = must(cfg.entities[0]);
    if (!("kind" in composite) || composite.kind !== "composite") throw new Error("missing tree");
    must(composite.nodes.child).links = { next: "leaf" };
    composite.nodes.leaf = { targetClass: `${EX}Leaf`, fragment: "leaf", fields: {} };
    const result = generateModel({
      ontologyTtl: `${ontology}\nex:Leaf a owl:Class; rdfs:label "Leaf"; rdfs:comment "Leaf" .`,
      shapesTtl: source,
      config: cfg,
      admissionNamespace: EX,
    });
    const e = must(defineModel(result.manifest).entities.Tree);
    const invalid = store(
      `<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ex:next ex:leaf; ex:keep "kept" .`,
    );
    await crossCheck(invalid, source, result.artifacts["shapes.ttl"], false);
    expect(e.parse(DOC, invalid)).toEqual(required ? undefined : {});
    const valid = store(
      `<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ex:next ex:leaf; ex:keep "kept" . ex:leaf a ex:Leaf .`,
    );
    await crossCheck(valid, source, result.artifacts["shapes.ttl"], true);
    expect(e.parse(DOC, valid)).toEqual({ keep: "kept" });
  });
  it("rejects omitted child constraints in compilation and fidelity", async () => {
    const source = profile("sh:datatype xsd:string; sh:maxCount 1");
    const shapes = parseShapes(source, `${EX}shapes/`, parseTurtle(ontology));
    const cfg = config();
    const composite = cfg.entities[0];
    if (!composite || !("kind" in composite) || composite.kind !== "composite")
      throw new Error("missing tree");
    must(composite.nodes.child).fields = {};
    await crossCheck(
      store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child ex:title 1 .`),
      source,
      emitShapesTtl(shapes, {}),
      false,
    );
    expect(() => compileManifest(shapes, cfg)).toThrow(/omits.*child.*constraint/i);
    const compiled = compileManifest(shapes, config());
    const tree = compiled.manifest.entities[0];
    if (tree?.kind !== "composite") throw new Error("missing tree");
    must(tree.nodes.find((node) => node.name === "child")).fields = [];
    expect(() => assertFidelity(shapes, compiled)).toThrow(/omits.*child.*constraint/i);
  });
});

describe("R10 M2: closed admission rejects implicit class targets", () => {
  it.each(["rdfs:Class", "owl:Class"])("rejects a shape that is also %s", async (kind) => {
    const source = `${H} ex:RootShape a sh:NodeShape; sh:targetClass ex:Root .
      ex:Root a sh:NodeShape, ${kind}; sh:property [ sh:path ex:title; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .
      ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child .`;
    // Emit the original graph even when the lossy projection is rejected.
    const { serializeCanonicalTurtle } = await import("../../src/rdf.js");
    const emitted = serializeCanonicalTurtle(parseTurtle(source), {});
    await crossCheck(store("ex:doc a ex:Root ."), source, emitted, kind === "owl:Class");
    // The workspace validator activates rdfs:Class implicit targets; owl:Class
    // alone is not activated by this engine. Admission rejects both spellings.
    await crossCheck(store('ex:doc a ex:Root; ex:title "valid" .'), source, emitted, true);
    expect(() =>
      generate(source, {
        shapesBase: `${EX}shapes/`,
        prefixes: {},
        entities: ["Root", "Child"].map((name) => ({
          name,
          targetClass: `${EX}${name}`,
          subject: { convention: "self" },
        })),
      }),
    ).toThrow(/implicit.*class.*target/i);
    const safe = parseShapes(
      source.replace(`, ${kind}`, ""),
      `${EX}shapes/`,
      parseTurtle(ontology),
    );
    const compiled = compileManifest(safe, {
      shapesBase: `${EX}shapes/`,
      prefixes: {},
      entities: ["Root", "Child"].map((name) => ({
        name,
        targetClass: `${EX}${name}`,
        subject: { convention: "self" },
      })),
    });
    safe.quads = parseTurtle(source);
    expect(() => compileManifest(safe, config())).toThrow(/implicit.*class.*target/i);
    expect(() => assertFidelity(safe, compiled)).toThrow(/implicit.*class.*target/i);
  });
});

describe("R10 M3: migration preserves explicit link class proofs", () => {
  it("materialises a class proved only through a deleted type alias", async () => {
    const source = profile(
      "sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1",
      true,
      "sh:class ex:Base; sh:node ex:ChildShape;",
    ).replace("sh:targetClass ex:Child;", "sh:targetClass ex:Child, ex:OldChild;");
    const result = generate(source);
    const e = must(defineModel(result.manifest).entities.Tree);
    const ds = store(
      `<${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:OldChild; ex:title "valid" . ex:OldChild rdfs:subClassOf ex:Base .`,
    );
    await crossCheck(ds, source, result.artifacts["shapes.ttl"], true);
    const before = e.parse(DOC, ds);
    expect(before).toEqual({ title: "valid" });
    const output = store(await e.storeToTurtle(ds));
    await crossCheck(output, source, result.artifacts["shapes.ttl"], true);
    expect(e.parse(DOC, output)).toEqual(before);
    expect(
      output
        .getObjects(`${EX}child`, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", null)
        .map((term) => term.value),
    ).toContain(`${EX}Base`);
  });
  it("backstop rejects losing another applicable shape during type migration", async () => {
    const source = `${H} ex:RootShape a sh:NodeShape; sh:targetClass ex:Root, ex:OldRoot .
      ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child .`;
    const result = generate(source, {
      shapesBase: `${EX}shapes/`,
      prefixes: {},
      entities: ["Root", "Child"].map((name) => ({
        name,
        targetClass: `${EX}${name}`,
        subject: { convention: "self" },
      })),
    });
    const ds = store("ex:doc a ex:OldRoot . ex:OldRoot rdfs:subClassOf ex:Child .");
    await crossCheck(ds, source, result.artifacts["shapes.ttl"], true);
    const model = defineModel(result.manifest);
    expect(model.entities.Child?.parse(DOC, ds)).toEqual({});
    await expect(async () => must(model.entities.Root).storeToTurtle(ds)).rejects.toMatchObject({
      name: "MigrationError",
    });
  });
});

describe("R10 M4: reject shared canonical predicates with aliases", () => {
  it("rejects migration ambiguity in compilation and fidelity", async () => {
    const onto = `${H} ${["A", "B"].map((name) => `ex:${name} a owl:Class; rdfs:label "${name}"; rdfs:comment "${name}" .`).join("\n")}
      ex:p a owl:DatatypeProperty; rdfs:label "p"; rdfs:comment "p"; rdfs:domain ex:A; rdfs:range xsd:string .`;
    const source = `${H} ex:AShape a sh:NodeShape; sh:targetClass ex:A;
      sh:property [ sh:path [ sh:alternativePath ( ex:p ex:old ) ]; sh:name "status"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 2; sh:in ( "pending" "active" ) ] .
      ex:BShape a sh:NodeShape; sh:targetClass ex:B;
      sh:property [ sh:path ex:p; sh:name "status"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1; sh:in ( "pending" ) ] .`;
    const shapes = parseShapes(source, `${EX}shapes/`, parseTurtle(onto));
    const cfg: CodegenConfig = {
      shapesBase: `${EX}shapes/`,
      prefixes: {},
      entities: ["A", "B"].map((name) => ({
        name,
        targetClass: `${EX}${name}`,
        subject: { convention: "self" },
      })),
    };
    await crossCheck(
      store('ex:doc a ex:A, ex:B; ex:p "pending"; ex:old "active" .'),
      source,
      emitShapesTtl(shapes, {}),
      true,
    );
    expect(() => compileManifest(shapes, cfg)).toThrow(/shared canonical predicate.*alias/i);
    const safe = parseShapes(
      source.replace("[ sh:alternativePath ( ex:p ex:old ) ]", "ex:p"),
      `${EX}shapes/`,
      parseTurtle(onto),
    );
    const compiled = compileManifest(safe, cfg);
    const a = compiled.manifest.entities[0];
    if (!a || a.kind === "composite") throw new Error("missing A");
    must(a.fields[0]).aliasPredicates = [`${EX}old`];
    expect(() => assertFidelity(shapes, compiled)).toThrow(/shared canonical predicate.*alias/i);
  });
});

describe("R10 M5: class-only links cannot project a narrower shape", () => {
  it("rejects projecting a child shape from a bare IRI link", async () => {
    const source = profile("sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1", true, "");
    const shapes = parseShapes(source, `${EX}shapes/`, parseTurtle(ontology));
    await crossCheck(
      store(`<${DOC}#it> a ex:Root; ex:link ex:child .`),
      source,
      emitShapesTtl(shapes, {}),
      true,
    );
    expect(() => compileManifest(shapes, config())).toThrow(/target class.*sh:class/i);
    const valid = parseShapes(
      source.replace("sh:nodeKind sh:IRI;", "sh:nodeKind sh:IRI; sh:node ex:ChildShape;"),
      `${EX}shapes/`,
      parseTurtle(ontology),
    );
    expect(() => assertFidelity(shapes, compileManifest(valid, config()))).toThrow(
      /target class.*sh:class/i,
    );
  });
  it("rejects subclass projections in compilation and fidelity", async () => {
    const source = profile(
      "sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1",
      true,
      "sh:class ex:Base;",
    );
    const shapes = parseShapes(source, `${EX}shapes/`, parseTurtle(ontology));
    await crossCheck(
      store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:Base .`),
      source,
      emitShapesTtl(shapes, {}),
      true,
    );
    expect(() => compileManifest(shapes, config())).toThrow(/target class.*sh:class/i);
    const safe = parseShapes(
      source.replace("sh:class ex:Base;", "sh:class ex:Base; sh:node ex:ChildShape;"),
      `${EX}shapes/`,
      parseTurtle(ontology),
    );
    const compiled = compileManifest(safe, config());
    expect(() => assertFidelity(shapes, compiled)).toThrow(/class.only|target class.*sh:class/i);
  });
  it("accepts exact-class projections", async () => {
    const source = profile("sh:datatype xsd:string; sh:maxCount 1", true, "sh:class ex:Child;");
    const result = generate(source);
    const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:Child .`);
    await crossCheck(ds, source, result.artifacts["shapes.ttl"], true);
    expect(defineModel(result.manifest).entities.Tree?.parse(DOC, ds)).toEqual({});
  });
});
