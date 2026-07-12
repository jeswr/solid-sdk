// AUTHORED-BY Codex GPT-5

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emitVocab } from "../src/emit.ts";
import { GENERATED_FILES, generatePackage } from "../src/generate.ts";
import { parseSector } from "../src/parse.ts";

const ONTOLOGY = resolve(
  import.meta.dirname,
  "../../../packages/solid-federation-vocab/sectors/bookmarks/bookmarks.ttl",
);
const SHAPES = resolve(
  import.meta.dirname,
  "../../../packages/solid-federation-vocab/sectors/bookmarks/bookmarks.shacl.ttl",
);
const COMMITTED = resolve(import.meta.dirname, "../generated/bookmarks-sector");
const temporaryDirectories: string[] = [];

async function parseFixture(
  propertyConstraint: string,
  datatype: string | null = "xsd:string",
  additionalShape = "",
  ontologyPropertyKind = "owl:DatatypeProperty",
  additionalProperty = "",
  propertyLocalName = "value",
) {
  const directory = await mkdtemp(join(tmpdir(), "federation-codegen-shape-"));
  temporaryDirectories.push(directory);
  const ontologyPath = join(directory, "sector.ttl");
  const shapesPath = join(directory, "sector.shacl.ttl");
  await Promise.all([
    writeFile(
      ontologyPath,
      `
        @prefix ex: <https://example.test/sector#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        @prefix vann: <http://purl.org/vocab/vann/> .
        <https://example.test/sector> a owl:Ontology ;
          vann:preferredNamespaceUri "https://example.test/sector#" .
        ex:Thing a owl:Class .
        ex:${propertyLocalName} a ${ontologyPropertyKind} .
      `,
      "utf8",
    ),
    writeFile(
      shapesPath,
      `
        @prefix ex: <https://example.test/sector#> .
        @prefix exsh: <https://example.test/shapes#> .
        @prefix sh: <http://www.w3.org/ns/shacl#> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        exsh:ThingShape a sh:NodeShape ;
          sh:targetClass ex:Thing ;
          sh:property [
            sh:path ex:${propertyLocalName} ;
            ${datatype === null ? "" : `sh:datatype ${datatype} ;`}
            ${propertyConstraint}
          ] ${additionalProperty} .
        ${additionalShape}
      `,
      "utf8",
    ),
  ]);
  return parseSector(ontologyPath, shapesPath);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("parseSector", () => {
  it("projects the bookmarks node shape into typed cardinalities and RDF term kinds", async () => {
    const model = await parseSector(ONTOLOGY, SHAPES);
    expect(model.shapes).toHaveLength(1);
    const shape = model.shapes[0];
    expect(shape).toMatchObject({
      className: "Bookmark",
      targetClass: "https://w3id.org/jeswr/sectors/bookmarks#Bookmark",
    });

    expect(shape?.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accessorName: "url",
          minCount: 1,
          maxCount: 1,
          path: "http://schema.org/url",
          value: expect.objectContaining({ termKind: "iri", typescriptType: "string" }),
        }),
        expect.objectContaining({
          accessorName: "archived",
          minCount: 0,
          maxCount: 1,
          value: expect.objectContaining({ termKind: "literal", typescriptType: "boolean" }),
        }),
        expect.objectContaining({
          accessorName: "hasTag",
          minCount: 0,
          requiredClass: "http://www.w3.org/2004/02/skos/core#Concept",
          value: expect.objectContaining({ termKind: "iri", typescriptType: "string" }),
        }),
      ]),
    );
  });

  it("uses only ontology and SHACL inputs and reproduces every committed output byte", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "federation-codegen-"));
    temporaryDirectories.push(outDir);
    await generatePackage({
      ontologyPath: ONTOLOGY,
      shapesPath: SHAPES,
      outDir,
      packageName: "@jeswr/generated-bookmarks-sector-model",
    });

    for (const file of GENERATED_FILES) {
      const [actual, expected] = await Promise.all([
        readFile(join(outDir, file), "utf8"),
        readFile(join(COMMITTED, file), "utf8"),
      ]);
      expect(actual, `${file} drifted from a fresh generation`).toBe(expected);
    }
  });

  it.each([
    { constraint: 'sh:pattern "safe" ;', name: "sh:pattern" },
    { constraint: "sh:or ( [ sh:datatype xsd:string ] ) ;", name: "sh:or" },
    { constraint: "sh:node exsh:OtherShape ;", name: "sh:node" },
    {
      constraint: "sh:qualifiedMinCount 1 ; sh:qualifiedValueShape [ sh:class ex:Thing ] ;",
      name: "qualified counts",
    },
  ])("rejects unsupported $name constraints instead of silently weakening them", async ({
    constraint,
  }) => {
    await expect(parseFixture(constraint)).rejects.toThrow(/Unsupported SHACL predicate/);
  });

  it.each([0, 2])("rejects unsupported bounded sh:maxCount %s", async (maxCount) => {
    await expect(parseFixture(`sh:maxCount ${maxCount} ;`)).rejects.toThrow(
      `Unsupported sh:maxCount ${maxCount}`,
    );
  });

  it.each([
    "xsd:decimal",
    "xsd:float",
    "xsd:integer",
  ])("rejects lossy or datatype-changing %s number mappings", async (datatype) => {
    await expect(parseFixture("", datatype)).rejects.toThrow(/Unsupported SHACL datatype/);
  });

  it.each([
    "sh:nodeKind sh:IRI ;",
    "sh:class ex:Thing ;",
  ])("rejects a datatype combined with %s", async (constraint) => {
    await expect(parseFixture(constraint)).rejects.toThrow(/Conflicting SHACL value constraints/);
  });

  it("rejects an accessor name that collides with the generated type helper", async () => {
    await expect(parseFixture('sh:name "isThing" ;')).rejects.toThrow(
      /collides with a generated type helper/,
    );
  });

  it("rejects duplicate emitted class names", async () => {
    await expect(
      parseFixture(
        "",
        "xsd:string",
        `
          exsh:DuplicateThingShape a sh:NodeShape ;
            sh:targetClass ex:Thing .
        `,
      ),
    ).rejects.toThrow(/Duplicate generated class name Thing/);
  });

  it("rejects a literal shape for a local owl:ObjectProperty", async () => {
    await expect(parseFixture("", "xsd:string", "", "owl:ObjectProperty")).rejects.toThrow(
      /conflicts with its ontology property kind/,
    );
  });

  it("rejects an IRI shape for a local owl:DatatypeProperty", async () => {
    await expect(parseFixture("sh:nodeKind sh:IRI ;", null)).rejects.toThrow(
      /conflicts with its ontology property kind/,
    );
  });

  it("rejects duplicate property paths even when sh:name values differ", async () => {
    await expect(
      parseFixture(
        "",
        "xsd:string",
        "",
        "owl:DatatypeProperty",
        `;
          sh:property [
            sh:path ex:value ;
            sh:name "alternateValue" ;
            sh:datatype xsd:boolean
          ]
        `,
      ),
    ).rejects.toThrow(/Duplicate property path/);
  });

  it("uses parser-reported prefixes and ignores prefix-like comments and literals", async () => {
    const model = await parseFixture(
      "",
      "xsd:string",
      `
        # @prefix ex: <https://attacker.invalid/> .
        ex:noise ex:value """@prefix ex: <https://attacker.invalid/> .""" .
        PREFIX alt: <https://example.test/alternative#>
        alt:subject alt:predicate alt:object .
      `,
    );
    expect(model.prefixes.ex).toBe("https://example.test/sector#");
    expect(model.prefixes.alt).toBe("https://example.test/alternative#");
  });

  it("rejects prefixes that normalize to the same namespace constant", async () => {
    await expect(
      parseFixture("", "xsd:string", "@prefix EX: <https://example.test/uppercase#> ."),
    ).rejects.toThrow(/collide as namespace constant EX_NS/);
  });

  it("emits a valid identifier for a dotted Turtle prefix", async () => {
    const model = await parseFixture(
      "",
      "xsd:string",
      "@prefix foo.bar: <https://example.test/dotted#> .",
    );
    expect(emitVocab(model)).toContain(
      'export const FOO_BAR_NS = "https://example.test/dotted#" as const;',
    );
  });

  it("rejects a namespace constant that collides with a generated RDF term", async () => {
    await expect(
      parseFixture("", "xsd:string", "", "owl:DatatypeProperty", "", "ns"),
    ).rejects.toThrow(/Namespace constant EX_NS collides with a generated RDF term/);
  });
});
