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
    const field = tampered.manifest.entities[0]?.fields.find((f) => f.name === "title");
    if (!field) throw new Error("title field missing");
    field.datatype = "http://www.w3.org/2001/XMLSchema#boolean"; // was xsd:string
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });

  it("FAILS on a seeded cardinality mutation", () => {
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const field = tampered.manifest.entities[0]?.fields.find((f) => f.name === "url");
    if (!field) throw new Error("url field missing");
    field.maxCount = 5; // was 1
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });

  it("FAILS on a dropped field (manifest omits a shape constraint)", () => {
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const entity = tampered.manifest.entities[0];
    if (!entity) throw new Error("entity missing");
    entity.fields = entity.fields.filter((f) => f.name !== "notes");
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });

  it("FAILS on an un-sourced guard (a scheme guard with no shape pattern and no config)", () => {
    const compiled = compileManifest(shapes, config);
    const tampered = structuredClone(compiled);
    const field = tampered.manifest.entities[0]?.fields.find((f) => f.name === "title");
    if (!field) throw new Error("title field missing");
    // title is a literal with no pattern — an iriScheme guard here is un-sourced.
    field.kind = "iri";
    field.guards = { ...(field.guards ?? {}), iriScheme: "http-https" };
    expect(() => assertFidelity(shapes, tampered)).toThrow(FidelityError);
  });
});
