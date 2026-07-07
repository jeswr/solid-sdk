// AUTHORED-BY Claude Opus 4.8
// Phase G — SHACL generator-readiness capabilities on the generator side:
//   G1  severity-aware requiredFailClosed  (Warning/Info minCount ⇒ NO guard)
//   G2  sh:in RDF-list extraction → manifest enum + admission
//   G3  sh:minInclusive / sh:maxInclusive / sh:minLength → closed named guards
//        + a singleton non-blank string guard
import { describe, expect, it } from "vitest";
import type { NormalizedOntology } from "../../src/adapter.js";
import {
  admit,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  FidelityError,
  type NormalizedShapes,
  parseShapes,
} from "../../src/index.js";

const SHAPES = `
@prefix sh:  <http://www.w3.org/ns/shacl#> .
@prefix ex:  <http://example.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass ex:Media ;
  # G1 — required, no severity ⇒ Violation default ⇒ fail-closed guard.
  sh:property [ sh:path ex:title ; sh:name "title" ;
    sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
  # G1 — required but Warning-graded ⇒ advisory ⇒ NO runtime guard.
  sh:property [ sh:path ex:artist ; sh:name "artist" ;
    sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Warning ] ;
  # G1 — required + explicit Violation ⇒ guard.
  sh:property [ sh:path ex:kind ; sh:name "kind" ;
    sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ; sh:severity sh:Violation ] ;
  # G2 — closed value set.
  sh:property [ sh:path ex:status ; sh:name "status" ;
    sh:datatype xsd:string ; sh:maxCount 1 ; sh:in ( "playing" "paused" "stopped" ) ] ;
  # G3 — numeric range.
  sh:property [ sh:path ex:rating ; sh:name "rating" ;
    sh:datatype xsd:integer ; sh:maxCount 1 ; sh:minInclusive 1 ; sh:maxInclusive 5 ] ;
  # G3 — singleton non-blank (minLength ≥ 1 on a scalar string).
  sh:property [ sh:path ex:code ; sh:name "code" ;
    sh:datatype xsd:string ; sh:maxCount 1 ; sh:minLength 1 ] ;
  # G4 — xsd:duration field (datatype coverage).
  sh:property [ sh:path ex:offset ; sh:name "offset" ;
    sh:datatype xsd:duration ; sh:maxCount 1 ] .
`;

const SHAPES_BASE = "http://example.org/shapes#";
const CONFIG: CodegenConfig = {
  shapesBase: SHAPES_BASE,
  prefixes: {
    ex: "http://example.org/",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  },
  entities: [
    {
      targetClass: "http://example.org/Media",
      name: "Media",
      subject: { convention: "hash-it" },
    },
  ],
};

const shapes = parseShapes(SHAPES, SHAPES_BASE);
const { manifest } = compileManifest(shapes, CONFIG);
const fields = manifest.entities[0]?.fields ?? [];
const byName = (n: string) => fields.find((f) => f.name === n);

describe("G1 — severity-aware requiredFailClosed", () => {
  it("an ABSENT-severity minCount ≥ 1 DOES compile a fail-closed guard", () => {
    expect(byName("title")?.guards?.requiredFailClosed).toBe(true);
  });
  it("an explicit sh:Violation minCount ≥ 1 DOES compile a guard", () => {
    expect(byName("kind")?.guards?.requiredFailClosed).toBe(true);
  });
  it("a sh:Warning-graded minCount ≥ 1 does NOT compile a required guard (advisory)", () => {
    expect(byName("artist")?.guards?.requiredFailClosed).toBeUndefined();
    // ...but the minCount is still projected onto the manifest field (shapes.ttl truth).
    expect(byName("artist")?.minCount).toBe(1);
  });
  it("fidelity PASSES — a warning-graded field with no guard is not unsourced", () => {
    expect(() => assertFidelity(shapes, compileManifest(shapes, CONFIG))).not.toThrow();
  });
  it("fidelity FAILS if a requiredFailClosed guard is forced on a Warning-graded field", () => {
    const compiled = compileManifest(shapes, CONFIG);
    const artist = compiled.manifest.entities[0]?.fields.find((f) => f.name === "artist");
    if (!artist) throw new Error("artist missing");
    artist.guards = { ...(artist.guards ?? {}), requiredFailClosed: true };
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
});

describe("G2 — sh:in RDF-list extraction → manifest enum", () => {
  it("extracts the closed value set to the manifest field's `in` list", () => {
    expect(byName("status")?.in).toEqual(["playing", "paused", "stopped"]);
  });
  it("the shape constraint carries the extracted value set", () => {
    const c = shapes.nodeShapes[0]?.properties.find((p) => p.name === "status");
    expect(c?.in).toEqual(["playing", "paused", "stopped"]);
  });
  it("fidelity requires the manifest enum to match the shape (tamper ⇒ throw)", () => {
    const compiled = compileManifest(shapes, CONFIG);
    const status = compiled.manifest.entities[0]?.fields.find((f) => f.name === "status");
    if (!status) throw new Error("status missing");
    status.in = ["playing", "paused"]; // dropped a member
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
});

describe("G2 — admission blocks an empty / malformed sh:in enumeration", () => {
  const ontology: NormalizedOntology = {
    namespace: "http://example.org/",
    classes: [{ iri: "http://example.org/Media", labels: ["Media"], definitions: ["Media."] }],
    properties: [],
  };

  it("admits a well-formed non-empty enum", () => {
    const report = admit(ontology, shapes, "http://example.org/");
    expect(report.violations.find((v) => v.code === "invalid-enum")).toBeUndefined();
  });

  it("REJECTS an empty sh:in (rdf:nil) as invalid-enum", () => {
    const badTtl = `
      @prefix sh:  <http://www.w3.org/ns/shacl#> .
      @prefix ex:  <http://example.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      [] a sh:NodeShape ; sh:targetClass ex:Media ;
        sh:property [ sh:path ex:status ; sh:name "status" ;
          sh:datatype xsd:string ; sh:maxCount 1 ; sh:in ( ) ] .`;
    const badShapes: NormalizedShapes = parseShapes(badTtl, SHAPES_BASE);
    const report = admit(ontology, badShapes, "http://example.org/");
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.code === "invalid-enum")).toBe(true);
  });
});

describe("G3 — numeric-range + non-blank closed guards", () => {
  it("compiles sh:minInclusive / sh:maxInclusive to closed numeric guards", () => {
    expect(byName("rating")?.guards?.minInclusive).toBe(1);
    expect(byName("rating")?.guards?.maxInclusive).toBe(5);
  });
  it("compiles sh:minLength to a closed minLength guard", () => {
    expect(byName("code")?.guards?.minLength).toBe(1);
  });
  it("adds a singleton non-blank guard for a minLength ≥ 1 scalar string", () => {
    expect(byName("code")?.guards?.nonBlank).toBe(true);
  });
  it("the guards are pure DATA numbers (no regex source in the manifest)", () => {
    const g = byName("rating")?.guards ?? {};
    for (const v of Object.values(g)) {
      expect(["number", "boolean"]).toContain(typeof v);
    }
    // No manifest field anywhere carries a `pattern` / regex-source key (§7.1 ban).
    for (const f of fields) {
      expect(Object.keys(f.guards ?? {})).not.toContain("pattern");
    }
  });
  it("fidelity PASSES for the full G1–G4 shape (all guards traceable to shapes)", () => {
    expect(() => assertFidelity(shapes, compileManifest(shapes, CONFIG))).not.toThrow();
  });
});

describe("G4 — xsd:duration is a recognised datatype in the projection", () => {
  it("the duration field compiles with its declared datatype", () => {
    expect(byName("offset")?.datatype).toBe("http://www.w3.org/2001/XMLSchema#duration");
  });
});
