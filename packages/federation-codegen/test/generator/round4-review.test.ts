// AUTHORED-BY Codex GPT-6
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineModel } from "@jeswr/model-runtime";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { DataFactory, Parser } from "n3";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  generateModel,
  parseShapes,
} from "../../src/index.js";
import { serializeCanonicalTurtle } from "../../src/rdf.js";

const EX = "https://ex.test/";
const BASE = `${EX}shapes/`;
const ATTACK = "urn:x> . <urn:evil> <urn:p> <urn:o> . #";
const HEADER = `@prefix ex: <${EX}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const ONTOLOGY = `${HEADER}
ex:Root a owl:Class; rdfs:label "Root"; rdfs:comment "Root" .
ex:Child a owl:Class; rdfs:label "Child"; rdfs:comment "Child" .`;
const SHAPES = `${HEADER}
ex:RootShape a sh:NodeShape; sh:targetClass ex:Root; sh:property [
  sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI; sh:node ex:ChildShape; sh:minCount 1; sh:maxCount 1 ] .
ex:ChildShape a sh:NodeShape; sh:targetClass ex:Child; sh:property [
  sh:path ex:title; sh:name "title"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .`;
function config(): CodegenConfig {
  return {
    shapesBase: BASE,
    prefixes: {},
    entities: [
      {
        name: "Tree",
        kind: "composite",
        root: "root",
        nodes: {
          root: { targetClass: `${EX}Root`, fragment: "it", links: { link: "child" } },
          child: { targetClass: `${EX}Child`, fragment: "child", fields: { title: {} } },
        },
      },
    ],
  };
}
const generate = (shapesTtl = SHAPES, cfg = config()) =>
  generateModel({ ontologyTtl: ONTOLOGY, shapesTtl, config: cfg, admissionNamespace: EX });
const engine = createRdfEngine();
afterAll(() => engine.dispose());

describe.each([
  "Turtle",
  "N-Triples",
] as const)("M2: the %s serialization boundary validates all RDF positions", (format) => {
  const { namedNode, literal, quad } = DataFactory;
  for (const unsafe of [ATTACK, "relative", "https://ex.test/a|b"]) {
    for (const position of [
      "subject",
      "predicate",
      "object",
      "graph",
      "type",
      "datatype",
    ] as const) {
      it(`rejects ${position} ${JSON.stringify(unsafe)}`, () => {
        const quads = [
          quad(
            namedNode(position === "subject" ? unsafe : `${EX}s`),
            namedNode(
              position === "predicate"
                ? unsafe
                : position === "type"
                  ? "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
                  : `${EX}p`,
            ),
            position === "datatype"
              ? literal("value", namedNode(unsafe))
              : namedNode(position === "object" || position === "type" ? unsafe : `${EX}o`),
            position === "graph" ? namedNode(unsafe) : DataFactory.defaultGraph(),
          ),
        ];
        expect(() => serializeCanonicalTurtle(quads, {}, format)).toThrow(TypeError);
      });
    }
    it(`rejects unsafe prefix namespaces ${JSON.stringify(unsafe)}`, () => {
      expect(() => serializeCanonicalTurtle([], { ex: unsafe }, format)).toThrow(TypeError);
    });
    it(`rejects shapesBase at config admission ${JSON.stringify(unsafe)}`, () => {
      const cfg = config();
      cfg.shapesBase = unsafe;
      expect(() => generate(SHAPES, cfg)).toThrow(/shapesBase/);
    });
  }
  it("rejects unsafe prefix labels", () => {
    expect(() => serializeCanonicalTurtle([], { "evil:": EX }, format)).toThrow(TypeError);
  });
  it("preserves safe lexical IRI identities", () => {
    const safe = "https://EX.test:443/café";
    const q = quad(
      namedNode(safe),
      namedNode(safe),
      literal("value", namedNode(safe)),
      format === "Turtle" ? namedNode(safe) : DataFactory.defaultGraph(),
    );
    const ttl = serializeCanonicalTurtle([q], { safe }, format);
    expect(new Parser().parse(ttl)[0]?.equals(q)).toBe(true);
    if (format === "Turtle") expect(ttl).toContain(`@prefix safe: <${safe}>`);
  });
});

describe("M1: contradictory constraints cannot disappear during projection", () => {
  for (const contradiction of ["datatype", "cardinality"] as const) {
    const badShapes =
      contradiction === "datatype"
        ? SHAPES.replace("sh:nodeKind sh:IRI", "sh:nodeKind sh:IRI; sh:datatype xsd:string")
        : SHAPES.replace("sh:minCount 1; sh:maxCount 1", "sh:minCount 2; sh:maxCount 1");
    it(`rejects the ${contradiction} contradiction end to end although a populated child parses`, async () => {
      const valid = generate();
      const e = defineModel(valid.manifest).entities.Tree;
      if (!e) throw new Error("missing tree");
      const data = e.build(`${EX}doc`, { title: "child" });
      expect(e.parse(`${EX}doc`, data)).toEqual({ title: "child" });
      expect((await engine.validate(data, badShapes)).conforms).toBe(false);
      expect(() => generate(badShapes)).toThrow(/datatype|cardinality|minCount/);
    });
    for (const projection of ["nested", "flat", "composite-flat"] as const) {
      it(`compiler rejects ${contradiction} for ${projection} properties`, () => {
        const shapes = parseShapes(badShapes, BASE);
        const cfg = config();
        if (projection === "flat") {
          cfg.entities = [
            { name: "Root", targetClass: `${EX}Root`, subject: { convention: "self" } },
            { name: "Child", targetClass: `${EX}Child`, subject: { convention: "self" } },
          ];
        } else if (projection === "composite-flat") {
          cfg.entities = [
            {
              name: "Root",
              kind: "composite",
              root: "root",
              nodes: {
                root: { targetClass: `${EX}Root`, fragment: "it", fields: { link: {} } },
              },
            },
            { name: "Child", targetClass: `${EX}Child`, subject: { convention: "self" } },
          ];
        }
        expect(() => compileManifest(shapes, cfg)).toThrow(/datatype|cardinality|minCount/);
      });
      it(`fidelity rejects ${contradiction} for ${projection} properties independently`, () => {
        const shapes = parseShapes(SHAPES, BASE);
        const cfg = config();
        if (projection === "flat") {
          cfg.entities = [
            { name: "Root", targetClass: `${EX}Root`, subject: { convention: "self" } },
            { name: "Child", targetClass: `${EX}Child`, subject: { convention: "self" } },
          ];
        } else if (projection === "composite-flat") {
          cfg.entities = [
            {
              name: "Root",
              kind: "composite",
              root: "root",
              nodes: {
                root: { targetClass: `${EX}Root`, fragment: "it", fields: { link: {} } },
              },
            },
            { name: "Child", targetClass: `${EX}Child`, subject: { convention: "self" } },
          ];
        }
        const compiled = compileManifest(shapes, cfg);
        const c = shapes.nodeShapes.find((s) => s.targetClass === `${EX}Root`)?.properties[0];
        if (!c) throw new Error("missing property");
        if (contradiction === "datatype") c.datatype = "http://www.w3.org/2001/XMLSchema#string";
        else c.minCount = 2;
        expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
      });
    }
  }
});

describe("M3: skolem identities preserve the original SHACL semantics", () => {
  const ontologyTtl = `${HEADER}
<https://a.test/Thing> a owl:Class; rdfs:label "A"; rdfs:comment "A" .
<https://b.test/Thing> a owl:Class; rdfs:label "B"; rdfs:comment "B" .`;
  const shapesTtl = `${HEADER}
ex:AShape a sh:NodeShape; sh:targetClass <https://a.test/Thing>; sh:property [
  sh:path ex:p; sh:name "p"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .
ex:BShape a sh:NodeShape; sh:targetClass <https://b.test/Thing>; sh:property [
  sh:path ex:p; sh:name "p"; sh:datatype xsd:string; sh:maxCount 1 ] .`;
  const cfg: CodegenConfig = {
    shapesBase: BASE,
    prefixes: {},
    entities: [
      { name: "A", targetClass: "https://a.test/Thing", subject: { convention: "self" } },
      { name: "B", targetClass: "https://b.test/Thing", subject: { convention: "self" } },
    ],
  };
  it("keeps required A and optional B properties separate across vocabulary namespaces", async () => {
    const result = generateModel({ ontologyTtl, shapesTtl, config: cfg });
    const runtime = defineModel(result.manifest);
    for (const name of ["A", "B"] as const) {
      const e = runtime.entities[name];
      if (!e) throw new Error("missing entity");
      for (const populated of [false, true]) {
        const data = e.build(`${EX}doc`, populated ? { p: "present" } : {});
        const original = await engine.validate(data, shapesTtl);
        expect(original.conforms).toBe(name === "B" || populated);
        const emitted = await engine.validate(data, result.artifacts["shapes.ttl"] as string);
        expect(emitted.conforms).toBe(original.conforms);
      }
    }
    const properties = parseShapes(shapesTtl, BASE).nodeShapes.map(
      (s) => s.properties[0]?.shapeIri,
    );
    expect(new Set(properties).size).toBe(2);
  });
  it("also separates anonymous node shapes with the same class local name", () => {
    const shapes = parseShapes(
      shapesTtl.replace("ex:AShape", "[]").replace("ex:BShape", "[]"),
      BASE,
    );
    expect(new Set(shapes.nodeShapes.map((s) => s.iri)).size).toBe(2);
  });
  it("derives property identities from full path IRIs regardless of property order", () => {
    const profile = (reverse = false) => `${HEADER} ex:S a sh:NodeShape; sh:targetClass ex:Root;
      sh:property ${["https://a.test/p", "https://b.test/p"]
        .sort((a, b) => (reverse ? b.localeCompare(a) : a.localeCompare(b)))
        .map((path) => `[ sh:path <${path}>; sh:datatype xsd:string; sh:maxCount 1 ]`)
        .join(", ")} .`;
    const ids = (ttl: string) =>
      parseShapes(ttl, BASE).nodeShapes[0]?.properties.map((p) => [p.pathIri, p.shapeIri]);
    expect(ids(profile(true))).toEqual(ids(profile()));
  });
  it("fails closed when a minted property IRI is already a named shape anywhere in the profile", () => {
    const iri = parseShapes(shapesTtl, BASE).nodeShapes[0]?.properties[0]?.shapeIri;
    expect(iri).toBeDefined();
    expect(() => parseShapes(`${shapesTtl}\n<${iri}> a sh:NodeShape .`, BASE)).toThrow(/collision/);
  });
  it("checks remaining RDF-list skolem IRIs against existing named shapes too", () => {
    const ttl = `${HEADER} ex:S a sh:NodeShape; sh:targetClass ex:Root; sh:property [ sh:path ex:p; sh:datatype xsd:string; sh:in ("a" "b") ] .`;
    const normalized = parseShapes(ttl, BASE);
    const property = normalized.nodeShapes[0]?.properties[0]?.shapeIri;
    const list = normalized.quads.find(
      (q) =>
        q.subject.termType === "NamedNode" &&
        q.subject.value !== property &&
        q.subject.value.startsWith(BASE),
    )?.subject.value;
    expect(list).toBeDefined();
    expect(() => parseShapes(`${ttl}\n<${list}> a sh:NodeShape .`, BASE)).toThrow(/collision/);
  });
});

it("H1/M2: walks every production writer and quad emission call site in both packages", () => {
  const packages = fileURLToPath(new URL("../../..", import.meta.url));
  const sites: string[] = [];
  const writerImports: string[] = [];
  for (const pkg of ["model-runtime", "federation-codegen"]) {
    const root = resolve(packages, pkg);
    // Also cover helpers/tests/scripts: an aliased Writer import must not hide a
    // second boundary. Dependency builds and generated output are not source.
    // Walk without descending into dot-directories: sibling tests create and delete
    // `.tmp-*` fixtures concurrently, and a recursive readdir would race them.
    const walk = (dir: string, rel = ""): string[] =>
      readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const file = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory())
          return entry.name.startsWith(".") ||
            ["dist", "node_modules", "generated"].includes(entry.name)
            ? []
            : walk(file, file);
        return /\.(?:ts|js|mjs)$/.test(entry.name) ? [file] : [];
      });
    for (const file of walk("")) {
      const path = resolve(root, file);
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isImportSpecifier(node) &&
          ["Writer", "StreamWriter"].includes(node.propertyName?.text ?? node.name.text)
        ) {
          writerImports.push(relative(packages, path));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    const dir = resolve(packages, pkg, "src");
    for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const path = resolve(dir, file);
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
          /^(?:Writer|.*\.(?:addQuads?|quad))$/.test(node.expression.getText(source))
        ) {
          let parent: ts.Node | undefined = node.parent;
          while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent;
          const owner = parent && ts.isFunctionDeclaration(parent) ? parent.name?.text : undefined;
          sites.push(`${relative(packages, path)}:${owner}:${node.expression.getText(source)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  expect(writerImports.sort()).toEqual([
    "federation-codegen/src/rdf.ts",
    "model-runtime/src/rdf.ts",
  ]);
  expect(sites.sort()).toEqual([
    // Ordered lowering adds explicit class/node-kind constraints at this same
    // validated generator writer boundary; runtime writes still use wrappers.
    "federation-codegen/src/emit.ts:emitShapesTtl:DataFactory.quad",
    // Concept-class lowering constructs sh:in and RDF-list quads. All three
    // pass through the same validated serializeCanonicalTurtle boundary.
    "federation-codegen/src/emit.ts:emitShapesTtl:DataFactory.quad",
    "federation-codegen/src/emit.ts:emitShapesTtl:DataFactory.quad",
    "federation-codegen/src/emit.ts:emitShapesTtl:DataFactory.quad",
    "federation-codegen/src/rdf.ts:serializeCanonicalTurtle:Writer",
    "federation-codegen/src/rdf.ts:serializeCanonicalTurtle:writer.addQuads",
    "federation-codegen/src/shapes.ts:parseShapes:DataFactory.quad",
    "model-runtime/src/rdf.ts:serializeTurtle:Writer",
    "model-runtime/src/rdf.ts:serializeTurtle:writer.addQuads",
  ]);
});
