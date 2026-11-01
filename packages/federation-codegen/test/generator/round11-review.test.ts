// AUTHORED-BY Codex GPT-6
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser, Store } from "n3";
import { afterAll, describe, expect, it } from "vitest";
import {
  admit,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";
import { serializeCanonicalTurtle } from "../../src/rdf.js";

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
async function crossCheck(ds: Store, source: string, emitted: string, conforms: boolean) {
  for (const profile of [source, emitted])
    expect((await engine.validate(ds, profile)).conforms).toBe(conforms);
}
const classes = (names: string[]) =>
  names
    .map((name) => `ex:${name} a owl:Class; rdfs:label "${name}"; rdfs:comment "${name}" .`)
    .join("\n");
const property = (name: string, owner: string, range = "xsd:string") =>
  `ex:${name} a owl:${range === "xsd:string" ? "Datatype" : "Object"}Property; rdfs:label "${name}"; rdfs:comment "${name}"; rdfs:domain ex:${owner}; rdfs:range ${range} .`;
const flatConfig = (): CodegenConfig => ({
  shapesBase: `${EX}shapes/`,
  prefixes: {},
  entities: [{ name: "Thing", targetClass: `${EX}Thing`, subject: { convention: "self" } }],
});
function flatFixture() {
  const ontologyTtl = `${H} ${classes(["Thing"])} ${property("p", "Thing")}`;
  const shapesTtl = `${H} ex:ThingShape a sh:NodeShape; sh:targetClass ex:Thing;
    sh:property [ sh:path [ sh:alternativePath ( ex:p ex:old ) ]; sh:name "values";
    sh:datatype xsd:string; sh:minCount 1; sh:maxCount 3 ] .`;
  return {
    shapesTtl,
    result: generateModel({ ontologyTtl, shapesTtl, config: flatConfig(), admissionNamespace: EX }),
  };
}
function treeFixture(severity?: string, scalar = false) {
  const ontologyTtl = `${H} ${classes(!scalar && severity ? ["Root", "Child", "Leaf"] : ["Root", "Child"])}
    ex:Child rdfs:subClassOf ex:Base .
    ${property("link", "Root", "ex:Child")} ${!scalar && severity ? property("next", "Child", "ex:Leaf") : ""}
    ${property("title", "Child")}`;
  const shapesTtl = `${H} ex:RootShape a sh:NodeShape; sh:targetClass ex:Root;
    sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI;
    sh:class ex:Base; sh:node ex:ChildShape; sh:minCount 1; sh:maxCount 1 ] .
    ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child, ex:OldChild;
    sh:property [ sh:path ex:title; sh:name "title"; sh:datatype xsd:string; sh:maxCount 1
      ${scalar ? `; sh:minCount 1; sh:severity sh:${severity}` : ""} ]
    ${!scalar && severity ? `; sh:property [ sh:path ex:next; sh:name "next"; sh:nodeKind sh:IRI; sh:node ex:LeafShape; sh:minCount 1; sh:maxCount 1; sh:severity sh:${severity} ]` : ""} .
    ${!scalar && severity ? "ex:LeafShape a sh:NodeShape; sh:targetClass ex:Leaf ." : ""}`;
  const config: CodegenConfig = {
    shapesBase: `${EX}shapes/`,
    prefixes: {},
    entities: [
      {
        name: "Tree",
        kind: "composite",
        root: "root",
        nodes: {
          root: { targetClass: `${EX}Root`, fragment: "it", links: { link: "child" } },
          child: {
            targetClass: `${EX}Child`,
            fragment: "child",
            fields: { title: {} },
            ...(!scalar && severity ? { links: { next: "leaf" } } : {}),
          },
          ...(!scalar && severity
            ? { leaf: { targetClass: `${EX}Leaf`, fragment: "leaf", fields: {} } }
            : {}),
        },
      },
    ],
  };
  return {
    shapesTtl,
    config,
    result: generateModel({ ontologyTtl, shapesTtl, config, admissionNamespace: EX }),
  };
}

describe("R11 M1: inherited implicit class targets", () => {
  it.each([
    "rdfs:Class",
    "owl:Class",
  ])("rejects subclass membership of %s at every boundary", async (kind) => {
    const ontologyTtl = `${H} ${classes(["Thing"])} ${property("title", "Thing")}`;
    const safeSource = `${H} ex:ThingShape a sh:NodeShape; sh:targetClass ex:Thing .
      ex:Thing a sh:NodeShape; sh:property [ sh:path ex:title; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .`;
    const source = `${safeSource} ex:Thing a ex:Meta . ex:Meta rdfs:subClassOf ex:Cycle .
      ex:Cycle rdfs:subClassOf ex:Meta, ${kind} .`;
    // The workspace validator does not activate inherited implicit class targets.
    // Cross-check that limitation explicitly; admission must still reject them.
    const emitted = serializeCanonicalTurtle(parseTurtle(source), {});
    await crossCheck(store("ex:doc a ex:Thing ."), source, emitted, true);
    await crossCheck(store('ex:doc a ex:Thing; ex:title "valid" .'), source, emitted, true);
    const ontology = owlRdfsAdapter.adapt(parseTurtle(ontologyTtl));
    const safe = parseShapes(safeSource, `${EX}shapes/`, ontology, parseTurtle(ontologyTtl));
    const compiled = compileManifest(safe, flatConfig());
    safe.quads = parseTurtle(source);
    expect(admit(ontology, safe, EX).violations.map((v) => v.code)).toContain(
      "implicit-class-target",
    );
    expect(() => compileManifest(safe, flatConfig())).toThrow(/implicit.*class.*target/i);
    expect(() => assertFidelity(safe, compiled)).toThrow(/implicit.*class.*target/i);
    expect(() => parseShapes(source, `${EX}shapes/`, ontology, parseTurtle(ontologyTtl))).toThrow(
      /implicit.*class.*target/i,
    );
  });
  it("does not treat ontology class declarations as shapes-graph implicit targets", () => {
    // SHACL activates implicit class targets from the shapes graph only.
    const ontology = parseTurtle(`${H} ${classes(["Thing"])} ex:Meta rdfs:subClassOf rdfs:Class .`);
    expect(() =>
      parseShapes(`${H} ex:Thing a sh:NodeShape, ex:Meta .`, `${EX}shapes/`, ontology),
    ).not.toThrow(/implicit.*class.*target/i);
  });
});

describe("R11 M2: nested minima survive severity grading", () => {
  for (const scalar of [false, true]) {
    it.each([
      "Warning",
      "Info",
    ])(`enforces absent child ${scalar ? "field" : "link"} minimum (%s)`, async (severity) => {
      const { shapesTtl, result } = treeFixture(severity, scalar);
      const ds = store(`<${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:Base .`);
      await crossCheck(ds, shapesTtl, result.artifacts["shapes.ttl"] as string, false);
      expect(defineModel(result.manifest).entities.Tree?.parse(DOC, ds)).toBeUndefined();
      const valid = store(
        `<${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:Base; ${scalar ? 'ex:title "valid"' : "ex:next ex:leaf"} .`,
      );
      await crossCheck(valid, shapesTtl, result.artifacts["shapes.ttl"] as string, true);
      expect(defineModel(result.manifest).entities.Tree?.parse(DOC, valid)).toEqual(
        scalar ? { title: "valid" } : {},
      );
    });
  }
  it("retains and fidelity-checks a nested link minimum independently of requiredness", () => {
    const { result, shapesTtl, config } = treeFixture("Warning");
    const shapes = parseShapes(
      shapesTtl,
      `${EX}shapes/`,
      parseTurtle(`${H} ${classes(["Child"])} ex:Child rdfs:subClassOf ex:Base .`),
    );
    const compiled = compileManifest(shapes, config);
    const entity = result.manifest.entities[0];
    if (entity?.kind !== "composite") throw new Error("missing composite");
    const field = entity.nodes
      .find((n) => n.name === "child")
      ?.fields.find((f) => f.name === "next");
    expect(field?.minCount).toBe(1);
    const tree = compiled.manifest.entities[0];
    if (tree?.kind !== "composite") throw new Error("missing composite");
    const next = tree.nodes.find((n) => n.name === "child")?.fields.find((f) => f.name === "next");
    if (!next) throw new Error("missing link");
    delete next.minCount;
    expect(() => assertFidelity(shapes, compiled)).toThrow(/minCount/);
  });
});

describe("R11 M3: every mutation uses transactional migration", () => {
  it.each([
    "add",
    "delete",
    "clear",
  ])("rejects lossy migration before %s and leaves the dataset unchanged", async (operation) => {
    const { shapesTtl, result } = flatFixture();
    const e = defineModel(result.manifest).entities.Thing;
    if (!e) throw new Error("missing entity");
    const ds = store('ex:doc a ex:Thing; ex:old "valid", 1 .');
    await crossCheck(ds, shapesTtl, result.artifacts["shapes.ttl"] as string, false);
    expect(e.parse(DOC, ds)).toBeUndefined();
    const before = [...ds];
    const w = new e.Wrapper(DOC, ds, DataFactory) as unknown as { values: Set<string> };
    expect(() => {
      if (operation === "add") w.values.add("valid");
      else if (operation === "delete") w.values.delete("absent");
      else w.values.clear();
    }).toThrow(/migration/i);
    expect([...ds]).toEqual(before);
  });
  it("generated child mark preserves indirect class proofs with the owning model", async () => {
    const { shapesTtl, result } = treeFixture();
    const dir = mkdtempSync(new URL("../../.round11-", import.meta.url).pathname);
    try {
      const filename = join(dir, "model.mjs");
      writeFileSync(filename, result.artifacts["model.js"] as string);
      const generated = await import(pathToFileURL(filename).href);
      const e = generated.entities.Tree;
      const ds = store(
        `<${DOC}#it> a ex:Root; ex:link ex:child . ex:child a ex:OldChild; ex:title "valid" . ex:OldChild rdfs:subClassOf ex:Base .`,
      );
      await crossCheck(ds, shapesTtl, result.artifacts["shapes.ttl"] as string, true);
      new generated.nodes.Tree.child.Wrapper(`${EX}child`, ds, DataFactory).mark();
      const output = store(await e.storeToTurtle(ds));
      await crossCheck(output, shapesTtl, result.artifacts["shapes.ttl"] as string, true);
      expect(e.parse(DOC, output)).toEqual({ title: "valid" });
      expect(
        ds
          .getObjects(`${EX}child`, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", null)
          .map((t) => t.value),
      ).toContain(`${EX}Base`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("R11 M4: set projection preservation is order independent", () => {
  it.each([
    true,
    false,
  ])("serializes valid alias sets (alias inserted first=%s)", async (aliasFirst) => {
    const { shapesTtl, result } = flatFixture();
    const ds = store(
      `ex:doc a ex:Thing . ${aliasFirst ? 'ex:doc ex:old "old"; ex:p "canonical" .' : 'ex:doc ex:p "canonical"; ex:old "old" .'}`,
    );
    const e = defineModel(result.manifest).entities.Thing;
    if (!e) throw new Error("missing entity");
    await crossCheck(ds, shapesTtl, result.artifacts["shapes.ttl"] as string, true);
    const before = [...ds];
    const output = store(await e.storeToTurtle(ds));
    await crossCheck(output, shapesTtl, result.artifacts["shapes.ttl"] as string, true);
    expect(new Set(e.parse(DOC, output)?.values as string[])).toEqual(
      new Set(["canonical", "old"]),
    );
    expect([...ds]).toEqual(before);
  });
});
