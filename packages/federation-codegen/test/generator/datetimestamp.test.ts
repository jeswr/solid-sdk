// AUTHORED-BY Codex GPT-6
import { defineModel, validateManifest, XSD } from "@jeswr/model-runtime";
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  AdmissionError,
  admit,
  type CodegenConfig,
  generateModel,
  owlRdfsAdapter,
  parseShapes,
  parseTurtle,
} from "../../src/index.js";
import { flat } from "../helpers.js";

const EX = "https://example.org/health#";
const TIME = "http://www.w3.org/2006/time#";
const SH = "http://www.w3.org/ns/shacl#";
const STAMP = `${XSD}dateTimeStamp`;
const PREFIX = `@prefix ex: <${EX}> . @prefix time: <${TIME}> .
  @prefix sh: <${SH}> . @prefix xsd: <${XSD}> .
  @prefix owl: <http://www.w3.org/2002/07/owl#> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;
const ontologyTtl = `${PREFIX}
  ex:Observation a owl:Class; rdfs:label "Observation"; rdfs:comment "A health observation" .
  time:inXSDDateTimeStamp a owl:DatatypeProperty;
    rdfs:label "Timestamp"; rdfs:comment "The observation instant";
    rdfs:domain ex:Observation; rdfs:range xsd:dateTimeStamp .`;
const shapesTtl = `${PREFIX}
  ex:ObservationShape a sh:NodeShape; sh:targetClass ex:Observation;
    sh:property [ sh:path time:inXSDDateTimeStamp; sh:name "recordedAt";
      sh:datatype xsd:dateTimeStamp; sh:minCount 1; sh:maxCount 1 ];
    sh:property [ sh:path ex:previousInstant; sh:name "previousInstants";
      sh:datatype xsd:dateTimeStamp; sh:maxCount 4 ] .`;
const config: CodegenConfig = {
  shapesBase: "https://example.org/health/shapes#",
  prefixes: { ex: EX, time: TIME, xsd: XSD },
  entities: [
    { name: "Observation", targetClass: `${EX}Observation`, subject: { convention: "self" } },
  ],
};

describe("xsd:dateTimeStamp health profile", () => {
  it("admits the reviewed datatype with no admission bypass", () => {
    const ontologyQuads = parseTurtle(ontologyTtl);
    const ontology = owlRdfsAdapter.adapt(ontologyQuads);
    const shapes = parseShapes(shapesTtl, config.shapesBase, ontology, ontologyQuads);
    expect(admit(ontology, shapes, EX, config)).toEqual({
      ok: true,
      namespace: EX,
      violations: [],
    });
  });

  it("emits Date types, exact manifest datatypes and unchanged SHACL datatypes", () => {
    const result = generateModel({ ontologyTtl, shapesTtl, config, admissionNamespace: EX });
    expect(result.admission.ok).toBe(true);
    const manifest = validateManifest(JSON.parse(result.artifacts["model.json"] as string));
    const fields = flat(manifest.entities[0]).fields;
    expect(fields.find((f) => f.name === "recordedAt")).toMatchObject({
      predicate: `${TIME}inXSDDateTimeStamp`,
      datatype: STAMP,
      kind: "literal",
      minCount: 1,
      maxCount: 1,
      guards: { requiredFailClosed: true },
    });
    expect(fields.find((f) => f.name === "previousInstants")).toMatchObject({
      datatype: STAMP,
      collection: "set",
    });
    const dts = result.artifacts["model.d.ts"] as string;
    expect(dts).toContain('"recordedAt": Date;');
    expect(dts).toContain('"recordedAt"?: Date;');
    expect(dts).toContain('"previousInstants"?: Date[];');
    expect(dts).toContain('readonly "previousInstants": Set<Date>;');
    const normalized = new Store(new Parser().parse(result.artifacts["shapes.ttl"] as string));
    const datatypes = normalized.getQuads(null, `${SH}datatype`, null, null);
    expect(datatypes).toHaveLength(2);
    expect(
      datatypes.every((q) => q.object.termType === "NamedNode" && q.object.value === STAMP),
    ).toBe(true);
    expect(normalized.getQuads(null, `${SH}path`, `${TIME}inXSDDateTimeStamp`, null)).toHaveLength(
      1,
    );

    const entity = defineModel(manifest).entities.Observation;
    if (!entity) throw new Error("Observation missing");
    const res = "https://example.org/observations/1";
    const recordedAt = new Date("2026-11-11T10:00:00.125Z");
    const ds = entity.build(res, { recordedAt, previousInstants: [recordedAt] });
    expect(entity.parse(res, ds)).toEqual({ recordedAt, previousInstants: [recordedAt] });
    const terms = ds.getObjects(res, `${TIME}inXSDDateTimeStamp`, null);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({
      termType: "Literal",
      value: recordedAt.toISOString(),
      datatype: { value: STAMP },
    });
    const zoneless = new Store(
      new Parser().parse(`${PREFIX}
      <${res}> a ex:Observation; time:inXSDDateTimeStamp "2026-11-11T10:00:00.125"^^xsd:dateTimeStamp .`),
    );
    expect(entity.parse(res, zoneless)).toBeUndefined();
  });

  it.each([
    "Violation",
    "Warning",
    "Info",
  ])("grades malformed timestamps with sh:%s severity", (severity) => {
    const result = generateModel({
      ontologyTtl,
      shapesTtl: shapesTtl.replace("sh:minCount 1;", `sh:severity sh:${severity}; sh:minCount 1;`),
      config,
      admissionNamespace: EX,
    });
    const entity = defineModel(result.manifest).entities.Observation;
    if (!entity) throw new Error("Observation missing");
    const res = "https://example.org/observations/1";
    const ds = new Store(
      new Parser().parse(`${PREFIX}
      <${res}> a ex:Observation; time:inXSDDateTimeStamp "2026-11-11T10:00:00"^^xsd:dateTimeStamp .`),
    );
    expect(entity.parse(res, ds)).toEqual(severity === "Violation" ? undefined : {});
  });

  it.each([
    "time",
    "gYear",
    "dateTimestamp",
    "DateTimeStamp",
  ])("still rejects unreviewed xsd:%s", (local) => {
    expect(() =>
      generateModel({
        ontologyTtl,
        shapesTtl: shapesTtl.replaceAll("xsd:dateTimeStamp", `xsd:${local}`),
        config,
        admissionNamespace: EX,
      }),
    ).toThrow(AdmissionError);
    expect(() =>
      generateModel({
        ontologyTtl,
        shapesTtl: shapesTtl.replaceAll("xsd:dateTimeStamp", `xsd:${local}`),
        config,
        admissionNamespace: EX,
      }),
    ).toThrow(/datatype has no validated runtime mapping/);
  });
});
