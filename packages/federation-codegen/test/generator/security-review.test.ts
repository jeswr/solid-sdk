// AUTHORED-BY Codex GPT-6
import { readFileSync } from "node:fs";
import { defineModel } from "@jeswr/model-runtime";
import { Parser, Store } from "n3";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  AdmissionError,
  admit,
  assertFidelity,
  type CodegenConfig,
  compileManifest,
  emitModelDts,
  FidelityError,
  isCompositeConfig,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";
import { flat } from "../helpers.js";

const EX = "https://ex.test/";
const PREFIX = `@prefix ex: <${EX}> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .`;
const cfg: CodegenConfig = {
  shapesBase: `${EX}shapes/`,
  prefixes: { ex: EX },
  entities: [{ name: "Thing", targetClass: `${EX}Thing`, subject: { convention: "hash-it" } }],
};
const shapesFor = (constraints = "", nodeConstraints = "") =>
  parseShapes(
    `${PREFIX} ex:S a sh:NodeShape; sh:targetClass ex:Thing; ${nodeConstraints} sh:property [ sh:path ex:p; sh:name "val"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1; ${constraints} ] .`,
    cfg.shapesBase,
  );
const ontology = owlRdfsAdapter.adapt(
  parseTurtle(
    `@prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . <${EX}Thing> a owl:Class; rdfs:label "Thing"; rdfs:comment "Thing" .`,
  ),
);

describe("security review R2: MUSTs cannot be weakened", () => {
  for (const mutation of ["remove", "false", "removeGuards"] as const) {
    it(`rejects seeded ${mutation} requiredFailClosed even with config provenance`, () => {
      const shapes = shapesFor();
      const config = structuredClone(cfg);
      const ec = config.entities[0];
      if (!ec || "kind" in ec) throw new Error("expected flat");
      ec.fields = { val: { requiredFailClosed: true } };
      const compiled = compileManifest(shapes, config);
      const f = flat(compiled.manifest.entities[0]).fields[0];
      if (!f?.guards) throw new Error("missing guards");
      if (mutation === "remove") delete f.guards.requiredFailClosed;
      if (mutation === "false") f.guards.requiredFailClosed = false;
      if (mutation === "removeGuards") delete f.guards;
      expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
    });
  }
  it("rejects config requiredFailClosed false on a Violation MUST", () => {
    const config = structuredClone(cfg);
    const ec = config.entities[0];
    if (!ec || "kind" in ec) throw new Error("expected flat");
    ec.fields = { val: { requiredFailClosed: false } };
    expect(() => compileManifest(shapesFor(), config)).toThrow(/requiredFailClosed|MUST/);
  });
});

describe("security review R3: closed SHACL admission", () => {
  for (const component of [
    "sh:maxLength 2;",
    "sh:or ( [ sh:minLength 5 ] );",
    'sh:pattern "^unknown";',
  ]) {
    it(`rejects unsupported property constraint ${component}`, () => {
      const report = admit(ontology, shapesFor(component), EX);
      expect(report.ok).toBe(false);
      expect(report.violations).toContainEqual(
        expect.objectContaining({ code: "unsupported-constraint", severity: "error" }),
      );
    });
  }
  for (const component of ["sh:closed true;", "sh:hasValue ex:Bad;"]) {
    it(`rejects unsupported node constraint ${component}`, () => {
      expect(admit(ontology, shapesFor("", component), EX).ok).toBe(false);
    });
  }
  it("rejects unsupported sh:class inside a logical operand before normalization", () => {
    expect(() => shapesFor("", "sh:not [ sh:class ex:Bad ];")).toThrow(AdmissionError);
  });
  it("checks shapes outside the ontology namespace and orphan property shapes", () => {
    const shapes = parseShapes(
      `${PREFIX} ex:S a sh:NodeShape; sh:targetClass <urn:External>; sh:closed true . ex:P a sh:PropertyShape; sh:path ex:p; sh:hasValue "required" .`,
      cfg.shapesBase,
    );
    expect(admit(ontology, shapes, "urn:elsewhere:").ok).toBe(false);
  });
});

it("security review R3: reports unsupported constraints in the full workspace media profile", () => {
  const base = new URL("../../../solid-federation-vocab/sectors/media/", import.meta.url);
  const ontologyQuads = parseTurtle(readFileSync(new URL("media.ttl", base), "utf8"));
  const ontology = owlRdfsAdapter.adapt(ontologyQuads);
  const shapes = parseShapes(
    readFileSync(new URL("media.shacl.ttl", base), "utf8"),
    `${EX}media-shapes/`,
    ontologyQuads,
  );
  const report = admit(ontology, shapes, ontology.namespace ?? "");
  const errors = report.violations.filter(
    (v) => v.code === "unsupported-constraint" && v.severity === "error",
  );
  expect(report.ok).toBe(false);
  expect(errors.some((v) => v.message.includes("pattern") && v.subject.endsWith("-isrc"))).toBe(
    true,
  );
  expect(
    errors.some((v) => v.message.includes("nodeKind") && v.subject.endsWith("-playedVia")),
  ).toBe(true);
});

const compositeTtl = (constraint = "sh:class ex:Track; sh:node ex:TrackShape;") => `${PREFIX}
ex:EventShape a sh:NodeShape; sh:targetClass ex:Event; sh:property [ sh:path ex:link; sh:name "link"; sh:nodeKind sh:IRI; sh:minCount 1; sh:maxCount 1; ${constraint} ] .
ex:TrackShape a sh:NodeShape; sh:targetClass ex:Track; sh:property [ sh:path ex:title; sh:name "title"; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ] .
ex:ArtistShape a sh:NodeShape; sh:targetClass ex:Artist .`;
const compConfig: CodegenConfig = {
  ...cfg,
  entities: [
    {
      name: "Tree",
      kind: "composite",
      root: "event",
      nodes: {
        event: { targetClass: `${EX}Event`, fragment: "it", links: { link: "track" } },
        track: { targetClass: `${EX}Track`, fragment: "track", fields: { title: {} } },
      },
    },
    { targetClass: `${EX}Artist`, name: "Artist", subject: { convention: "self" } },
  ],
};

describe("security review R5: composite target conformance", () => {
  for (const constraint of [
    "sh:class ex:Track;",
    "sh:node ex:TrackShape;",
    "sh:class ex:Track; sh:node ex:TrackShape;",
  ]) {
    it(`rejects configured and seeded wrong link targets (${constraint})`, () => {
      const shapes = parseShapes(compositeTtl(constraint), cfg.shapesBase);
      const config = structuredClone(compConfig);
      const comp = config.entities[0];
      if (!comp || !isCompositeConfig(comp) || !comp.nodes.event)
        throw new Error("expected composite");
      comp.nodes.artist = { targetClass: `${EX}Artist`, fragment: "artist" };
      comp.nodes.event.links = { link: "artist" };
      // Keep the Track projected as a flat entity to isolate the link-target check.
      delete comp.nodes.track;
      config.entities = [
        comp,
        { targetClass: `${EX}Track`, name: "Track", subject: { convention: "self" } },
      ];
      expect(() => compileManifest(shapes, config)).toThrow(/target|class|shape/);
      const compiled = compileManifest(shapes, compConfig);
      const c = compiled.manifest.entities.find((e) => e.kind === "composite");
      if (c?.kind !== "composite") throw new Error("expected composite");
      const target = c.nodes.find((n) => n.name === "track");
      if (!target) throw new Error("missing track node");
      // Keep a valid tree and project every shape exactly once: Track becomes flat,
      // and the link now reaches an empty Artist node instead of a titled Track.
      compiled.manifest.entities = compiled.manifest.entities.filter((e) => e.name !== "Artist");
      compiled.manifest.entities.push({
        name: "Track",
        typeIris: [`${EX}Track`],
        subject: { convention: "self" },
        fields: structuredClone(target.fields),
      });
      target.typeIris = [`${EX}Artist`];
      target.fields = [];
      expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
    });
  }
});

it("security review R2: rejects seeded composite flat MUST removal", () => {
  const shapes = parseShapes(compositeTtl(), cfg.shapesBase);
  for (const mutation of ["remove", "false"] as const) {
    const compiled = compileManifest(shapes, compConfig);
    const comp = compiled.manifest.entities.find((e) => e.kind === "composite");
    if (comp?.kind !== "composite") throw new Error("missing composite");
    const f = comp.nodes.find((n) => n.name === "track")?.fields[0];
    if (!f?.guards) throw new Error("missing guards");
    if (mutation === "remove") delete f.guards;
    else f.guards.requiredFailClosed = false;
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
  }
});

describe("security review R8: https pattern fidelity", () => {
  const shapes = parseShapes(
    `${PREFIX} ex:S a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path ex:p; sh:name "val"; sh:nodeKind sh:IRI; sh:minCount 1; sh:maxCount 1; sh:pattern "^https://" ] .`,
    cfg.shapesBase,
  );
  it("compiles an https-only scheme and rejects http RDF", () => {
    const compiled = compileManifest(shapes, cfg);
    expect(flat(compiled.manifest.entities[0]).fields[0]?.guards?.iriScheme).toBe("https");
    const e = defineModel(compiled.manifest).entities.Thing;
    expect(
      e?.parse(
        `${EX}doc`,
        new Store(
          new Parser().parse(
            `<${EX}doc#it> a ex:Thing .`.replace("ex:Thing", `<${EX}Thing>`) +
              `<${EX}doc#it> <${EX}p> <http://insecure.test/> .`,
          ),
        ),
      ),
    ).toBeUndefined();
  });
  it("rejects a seeded scheme widening even with config provenance", () => {
    const config = structuredClone(cfg);
    const ec = config.entities[0];
    if (!ec || "kind" in ec) throw new Error("expected flat");
    ec.fields = { val: { iriScheme: "http-https" } };
    const compiled = compileManifest(shapes, cfg);
    const f = flat(compiled.manifest.entities[0]).fields[0];
    if (!f) throw new Error("missing field");
    f.guards = { ...f.guards, iriScheme: "http-https" };
    const prov = compiled.provenance[0];
    if (prov) prov.configGuards.push("iriScheme");
    expect(() => assertFidelity(shapes, compiled)).toThrow(FidelityError);
    expect(() => compileManifest(shapes, config)).toThrow(/scheme|pattern/i);
  });
});

it("security review R13: set enum declarations accept arrays and reject scalars", () => {
  const shapes = parseShapes(
    `${PREFIX} ex:S a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path ex:p; sh:name "val"; sh:datatype xsd:string; sh:in ("a" "b") ] .`,
    cfg.shapesBase,
  );
  const dts = emitModelDts(compileManifest(shapes, cfg).manifest);
  const data = /export interface ThingData \{[^}]+\}/.exec(dts)?.[0] ?? "";
  const source = `${data}\nconst good: ThingData = {val: ["a"]};\n// @ts-expect-error scalar must not satisfy a set\nconst bad: ThingData = {val: "a"};`;
  const fileName = "/security-enum.ts";
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: [],
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, ...rest) =>
    name === fileName
      ? ts.createSourceFile(name, source, version, true)
      : original(name, version, ...rest);
  const program = ts.createProgram([fileName], options, host);
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
  ).toEqual([]);
});
