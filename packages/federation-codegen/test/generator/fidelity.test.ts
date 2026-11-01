// AUTHORED-BY Claude Opus 4.8
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  parseShapes,
} from "../../src/index.js";
import { flat } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = join(here, "..", "..", "examples", "bookmark");

const config = JSON.parse(
  readFileSync(join(exampleDir, "codegen.config.json"), "utf8"),
) as CodegenConfig;
const shapes = parseShapes(
  readFileSync(join(exampleDir, "bookmark.shacl.ttl"), "utf8"),
  config.shapesBase,
);

describe("fidelity assertion (the P0 exit criterion)", () => {
  it("PASSES for the faithfully-compiled manifest", () => {
    const compiled = compileManifest(shapes, config);
    expect(() => assertFidelity(shapes, compiled)).not.toThrow();
  });

  it("FAILS (throws) on a seeded datatype mutation", () => {
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const field = flat(tampered.manifest.entities[0]).fields.find((f) => f.name === "title");
    if (!field) throw new Error("title field missing");
    field.datatype = "http://www.w3.org/2001/XMLSchema#boolean"; // was xsd:string
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });

  it("FAILS on a seeded cardinality mutation", () => {
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const field = flat(tampered.manifest.entities[0]).fields.find((f) => f.name === "url");
    if (!field) throw new Error("url field missing");
    field.maxCount = 5; // was 1
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });

  it("FAILS on a dropped field (manifest omits a shape constraint)", () => {
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const entity = flat(tampered.manifest.entities[0]);
    entity.fields = entity.fields.filter((f) => f.name !== "notes");
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });

  it("FAILS on an un-sourced guard (a scheme guard with no shape pattern and no config)", () => {
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const field = flat(tampered.manifest.entities[0]).fields.find((f) => f.name === "title");
    if (!field) throw new Error("title field missing");
    // title is a literal with no pattern — an iriScheme guard here is un-sourced.
    field.kind = "iri";
    field.guards = { ...(field.guards ?? {}), iriScheme: "http-https" };
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });

  it("FAILS on a tampered defaultNow-only field (a build-time default with no config source)", () => {
    // A field carrying ONLY defaultNow (no guards, no `default`) must still be traced —
    // otherwise a tampered manifest could smuggle an un-sourced build-time default past
    // the traceability check. `title` has no config `defaultNow`, so forcing one throws.
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const field = flat(tampered.manifest.entities[0]).fields.find((f) => f.name === "title");
    if (!field) throw new Error("title field missing");
    field.guards = undefined; // strip any guards so the field is defaultNow-ONLY
    field.defaultNow = true; // un-sourced build-time default
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });
});

describe("fidelity — per-entity keying (no cross-entity misattribution)", () => {
  // Two entities share a field name ("ref") AND a predicate (ex:link), but A's is an
  // http-pattern IRI (a shape-derived scheme guard) and B's is a plain string literal.
  // Global (by-name/by-predicate) keying would misattribute; per-entity keying must not.
  const SharedShape = `
    @prefix sh:  <http://www.w3.org/ns/shacl#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    @prefix ex:  <https://ex.org/> .
    [] a sh:NodeShape ; sh:targetClass ex:A ;
      sh:property [ sh:path ex:link ; sh:name "ref" ; sh:nodeKind sh:IRI ; sh:pattern "^https?://" ; sh:maxCount 1 ] .
    [] a sh:NodeShape ; sh:targetClass ex:B ;
      sh:property [ sh:path ex:link ; sh:name "ref" ; sh:datatype xsd:string ; sh:maxCount 1 ] .
  `;
  const sharedConfig: CodegenConfig = {
    shapesBase: "https://ex.org/shapes#",
    prefixes: { ex: "https://ex.org/", xsd: "http://www.w3.org/2001/XMLSchema#" },
    entities: [
      { targetClass: "https://ex.org/A", name: "A", subject: { convention: "hash-it" } },
      { targetClass: "https://ex.org/B", name: "B", subject: { convention: "hash-it" } },
    ],
  };

  it("PASSES: A.ref keeps its shape-derived scheme guard; B.ref (literal) has none", () => {
    const shared = parseShapes(SharedShape, sharedConfig.shapesBase);
    const compiled = compileManifest(shared, sharedConfig);
    const a = flat(compiled.manifest.entities.find((e) => e.name === "A"));
    const b = flat(compiled.manifest.entities.find((e) => e.name === "B"));
    expect(a.fields[0]?.guards?.iriScheme).toBe("http-https");
    expect(b.fields[0]?.guards?.iriScheme).toBeUndefined();
    expect(() => assertFidelity(shared, compiled)).not.toThrow();
  });
});
