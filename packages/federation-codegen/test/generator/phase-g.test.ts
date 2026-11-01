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
  emitModelDts,
  FidelityError,
  type NormalizedShapes,
  parseShapes,
} from "../../src/index.js";
import { flat } from "../helpers.js";

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
const fields = flat(manifest.entities[0]).fields;
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
    const artist = flat(compiled.manifest.entities[0]).fields.find((f) => f.name === "artist");
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
    const status = flat(compiled.manifest.entities[0]).fields.find((f) => f.name === "status");
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

  it("REJECTS a list node with duplicate rdf:first (no silent first-pick)", () => {
    // A hand-built list node carrying TWO rdf:first triples: the old graph.object()
    // single-take silently produced ["a"]; the fail-closed walk must yield the
    // present-but-empty [] sentinel so admission flags it (not accept a truncation).
    const badTtl = `
      @prefix sh:  <http://www.w3.org/ns/shacl#> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix ex:  <http://example.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      [] a sh:NodeShape ; sh:targetClass ex:Media ;
        sh:property [ sh:path ex:status ; sh:name "status" ; sh:datatype xsd:string ; sh:maxCount 1 ;
          sh:in [ rdf:first "a" ; rdf:first "b" ; rdf:rest rdf:nil ] ] .`;
    const badShapes = parseShapes(badTtl, SHAPES_BASE);
    const status = badShapes.nodeShapes[0]?.properties.find((p) => p.name === "status");
    expect(status?.in).toEqual([]);
    const report = admit(ontology, badShapes, "http://example.org/");
    expect(report.violations.some((v) => v.code === "invalid-enum")).toBe(true);
  });

  it("REJECTS a list node with duplicate rdf:rest (branching tail)", () => {
    const badTtl = `
      @prefix sh:  <http://www.w3.org/ns/shacl#> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      @prefix ex:  <http://example.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      [] a sh:NodeShape ; sh:targetClass ex:Media ;
        sh:property [ sh:path ex:status ; sh:name "status" ; sh:datatype xsd:string ; sh:maxCount 1 ;
          sh:in [ rdf:first "a" ; rdf:rest rdf:nil ; rdf:rest ( "b" ) ] ] .`;
    const badShapes = parseShapes(badTtl, SHAPES_BASE);
    const status = badShapes.nodeShapes[0]?.properties.find((p) => p.name === "status");
    expect(status?.in).toEqual([]);
    const report = admit(ontology, badShapes, "http://example.org/");
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

describe("G1 — *Data requiredness tracks the runtime guard, not shape cardinality", () => {
  // The module-level Media shape has: title (minCount 1, ungraded ⇒ required),
  // kind (minCount 1, sh:Violation ⇒ required), and artist (minCount 1, sh:Warning
  // ⇒ ADVISORY, admitted-when-absent ⇒ optional). Typing an advisory-required field
  // as required would make the static type reject objects the runtime accepts.
  const dts = emitModelDts(manifest);
  const dataBlock = dts.slice(
    dts.indexOf("export interface MediaData"),
    dts.indexOf("export interface MediaWrapper"),
  );

  it("a Violation/ungraded minCount ≥ 1 field is REQUIRED in *Data (no `?`)", () => {
    expect(dataBlock).toContain('"title": string;');
    expect(dataBlock).toContain('"kind": string;');
    expect(dataBlock).not.toContain('"title"?:');
    expect(dataBlock).not.toContain('"kind"?:');
  });
  it("a Warning-graded minCount ≥ 1 field is OPTIONAL in *Data (advisory admission)", () => {
    expect(dataBlock).toContain('"artist"?: string;');
    expect(dataBlock).not.toContain('"artist": string;');
  });
});

describe("G2 — sh:in numeric coercion covers the unsigned XSD integer subtypes", () => {
  // The unsigned subtypes map to `number` in emit.ts / the runtime, so an enum of
  // unsigned literals must coerce to NUMERIC scalars (not strings) or the generated
  // union type and the runtime enum would disagree.
  const unsignedTtl = `
    @prefix sh:  <http://www.w3.org/ns/shacl#> .
    @prefix ex:  <http://example.org/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    [] a sh:NodeShape ; sh:targetClass ex:Media ;
      sh:property [ sh:path ex:level ; sh:name "level" ; sh:datatype xsd:unsignedInt ;
        sh:maxCount 1 ; sh:in ( "1"^^xsd:unsignedInt "2"^^xsd:unsignedInt "3"^^xsd:unsignedInt ) ] ;
      sh:property [ sh:path ex:big ; sh:name "big" ; sh:datatype xsd:unsignedLong ;
        sh:maxCount 1 ; sh:in ( "10"^^xsd:unsignedLong "20"^^xsd:unsignedLong ) ] ;
      sh:property [ sh:path ex:tiny ; sh:name "tiny" ; sh:datatype xsd:unsignedByte ;
        sh:maxCount 1 ; sh:in ( "7"^^xsd:unsignedByte ) ] .`;
  const uShapes = parseShapes(unsignedTtl, SHAPES_BASE);
  const { manifest: uManifest } = compileManifest(uShapes, CONFIG);
  const uFields = flat(uManifest.entities[0]).fields;
  const uByName = (n: string) => uFields.find((f) => f.name === n);

  it("coerces an xsd:unsignedInt enum to numeric scalars", () => {
    expect(uByName("level")?.in).toEqual([1, 2, 3]);
    for (const v of uByName("level")?.in ?? []) expect(typeof v).toBe("number");
  });
  it("coerces xsd:unsignedLong and xsd:unsignedByte enums to numeric scalars", () => {
    expect(uByName("big")?.in).toEqual([10, 20]);
    expect(uByName("tiny")?.in).toEqual([7]);
    for (const f of ["big", "tiny"])
      for (const v of uByName(f)?.in ?? []) expect(typeof v).toBe("number");
  });
  it("the shape constraint carries the coerced numeric value set", () => {
    const c = uShapes.nodeShapes[0]?.properties.find((p) => p.name === "level");
    expect(c?.in).toEqual([1, 2, 3]);
  });
  it("emits a NUMERIC union type for the unsigned enum (no quoted string members)", () => {
    const dts = emitModelDts(uManifest);
    expect(dts).toContain("1 | 2 | 3");
    expect(dts).not.toContain('"1" | "2" | "3"');
  });
});

describe("G3 — lexical guards (minLength / nonBlank) only on string-valued literals", () => {
  // The runtime applies minLength / nonBlank only to string VALUES. Emitting them on
  // a numeric literal would be a runtime no-op the fidelity assertion would miscount
  // as coverage, so compile must gate them to string-valued fields.
  const mixedTtl = `
    @prefix sh:  <http://www.w3.org/ns/shacl#> .
    @prefix ex:  <http://example.org/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    [] a sh:NodeShape ; sh:targetClass ex:Media ;
      sh:property [ sh:path ex:label ; sh:name "label" ; sh:datatype xsd:string ;
        sh:maxCount 1 ; sh:minLength 2 ] ;
      sh:property [ sh:path ex:count ; sh:name "count" ; sh:datatype xsd:integer ;
        sh:maxCount 1 ; sh:minLength 2 ] .`;
  const mixed = parseShapes(mixedTtl, SHAPES_BASE);
  const { manifest: mixedManifest } = compileManifest(mixed, CONFIG);
  const mByName = (n: string) => flat(mixedManifest.entities[0]).fields.find((f) => f.name === n);

  it("emits minLength + nonBlank for a string-valued literal", () => {
    expect(mByName("label")?.guards?.minLength).toBe(2);
    expect(mByName("label")?.guards?.nonBlank).toBe(true);
  });
  it("does NOT emit minLength / nonBlank for a numeric literal (runtime no-op)", () => {
    expect(mByName("count")?.guards?.minLength).toBeUndefined();
    expect(mByName("count")?.guards?.nonBlank).toBeUndefined();
  });
  it("fidelity PASSES — the un-emitted numeric lexical guard is not a coverage gap", () => {
    expect(() => assertFidelity(mixed, compileManifest(mixed, CONFIG))).not.toThrow();
  });
});

describe("fidelity — a guard whose VALUE disagrees with the shape is not shape-derived", () => {
  // The Media shape (module-level) carries rating {minInclusive 1, maxInclusive 5},
  // code {minLength 1, nonBlank}, and required title/kind (requiredFailClosed). A
  // manifest that keeps the guard KEY but tampers its VALUE (or flips a boolean guard
  // to a no-op false) must fail fidelity — the old key-only check let it pass.
  const fresh = () => compileManifest(shapes, CONFIG);
  // Returns the LIVE guards object off the compiled manifest — mutating it tampers
  // the manifest in place (same reference), so a test can flip one guard value.
  const guardsOf = (compiled: ReturnType<typeof fresh>, name: string) => {
    const f = flat(compiled.manifest.entities[0]).fields.find((e) => e.name === name);
    if (!f?.guards) throw new Error(`${name} guards missing`);
    return f.guards;
  };

  it("FAILS when a minInclusive guard value is widened past the shape bound", () => {
    const compiled = fresh();
    guardsOf(compiled, "rating").minInclusive = 999; // shape says 1
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
  it("FAILS when a maxInclusive guard value disagrees with the shape", () => {
    const compiled = fresh();
    guardsOf(compiled, "rating").maxInclusive = 4; // shape says 5
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
  it("FAILS when a minLength guard value disagrees with the shape", () => {
    const compiled = fresh();
    guardsOf(compiled, "code").minLength = 8; // shape says 1
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
  it("FAILS when a boolean nonBlank guard is flipped to a no-op false", () => {
    const compiled = fresh();
    guardsOf(compiled, "code").nonBlank = false;
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
  it("FAILS when requiredFailClosed is flipped to a no-op false on a required field", () => {
    const compiled = fresh();
    guardsOf(compiled, "title").requiredFailClosed = false;
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  });
  it("still PASSES for the faithfully-compiled manifest (values agree)", () => {
    expect(() => assertFidelity(shapes, fresh())).not.toThrow();
  });
});
