// AUTHORED-BY Codex GPT-6.1-Sol
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { DataFactory, Parser, Store } from "n3";
import { assert, describe, expect, it } from "vitest";
import { HealthDocument, Observation } from "../src/model.js";
import { toTurtle } from "../src/serialise.js";
import { TypeIndexDataset } from "../src/type-index.js";
import { HealthClass } from "../src/vocab.js";

const aliases = (base: string) => [
  base,
  ...Object.keys(LEGACY_NAMESPACES).filter((key) => LEGACY_NAMESPACES[key] === base),
];
const legacyPh = aliases(NS.POD_HEALTH)[1];
assert(legacyPh);
const parse = (source: string) => new Store(new Parser().parse(source));

describe("canonical and legacy health vocabulary", () => {
  it.each(aliases(NS.HEALTH))("reads complete clinical entries from %s", async (health) => {
    const core = aliases(NS.CORE)[health === NS.HEALTH ? 0 : 1];
    assert(core);
    const dataset = parse(`
      @prefix h: <${health}> . @prefix core: <${core}> .
      <urn:record> a h:HealthRecord ; core:subject <urn:patient> ; h:hasEntry <urn:obs> .
      <urn:obs> a h:HeartRateObservation ; h:value 72 ; h:unitCode "/min" ;
        h:patient <urn:patient> ; h:hasCode <urn:code> .
      <urn:code> a h:CodeableConcept ; core:value "8867-4" ; core:inScheme <http://loinc.org> .
      <urn:condition> a h:Condition ; h:patient <urn:patient> ; h:hasCode <urn:code> .
      <urn:medication> a h:MedicationStatement ; h:medication <urn:product> .
      <urn:immunization> a h:Immunization ; h:medication <urn:product> .
      <urn:product> a h:MedicinalProduct .
    `);
    const document = new HealthDocument(dataset, DataFactory);
    expect([...document.records][0]?.patientSubject).toBe("urn:patient");
    expect([...document.records][0]?.entries.has("urn:obs")).toBe(true);
    expect([...document.observations][0]?.kind).toBe("HeartRate");
    expect([...document.observations][0]?.measuredValue).toBe(72);
    expect([...document.conditions][0]?.code).toBe("urn:code");
    expect([...document.medicationStatements][0]?.medication).toBe("urn:product");
    expect([...document.immunizations][0]?.vaccine).toBe("urn:product");
    expect([...document.medicinalProducts]).toHaveLength(1);
    expect([...document.codeableConcepts][0]?.code).toBe("8867-4");
    expect(document.codeableConcept("urn:code").scheme).toBe("http://loinc.org");
    const output = await toTurtle(document);
    expect(() => new Parser({ format: "text/turtle" }).parse(output)).not.toThrow();
    expect(output).not.toContain("TBD.example");
    expect(output).not.toContain("w3id.org/jeswr");
  });

  it.each(aliases(NS.CORE))("accepts core predicate aliases %s", (core) => {
    const dataset = parse(`<urn:c> <${core}value> "test" ; <${core}inScheme> <urn:scheme> .`);
    const document = new HealthDocument(dataset, DataFactory);
    expect(document.codeableConcept("urn:c").code).toBe("test");
    expect(document.codeableConcept("urn:c").scheme).toBe("urn:scheme");
  });

  it("normalizes standalone terms and named graphs without rewriting literal contents or identities", async () => {
    const health = aliases(NS.HEALTH)[1];
    assert(health);
    const source = `GRAPH <urn:graph> { <urn:obs> a <${health}Observation> ; <${health}value> 12 . }
      <urn:workout> a <${legacyPh}Workout> ; <${legacyPh}activityType> "Run" ; <${legacyPh}hasPoint> <urn:point> .
      <urn:point> a <${legacyPh}RoutePoint> ; <${legacyPh}sequence> 0 .
      <urn:literal> <urn:label> "${health}Observation" .`;
    const dataset = new Store(new Parser({ format: "TriG" }).parse(source));
    expect(new Observation("urn:obs", dataset, DataFactory).measuredValue).toBe(12);
    expect(
      [...dataset].some(
        (q) => q.graph.value === "urn:graph" && q.object.value === HealthClass.Observation,
      ),
    ).toBe(true);
    const document = new HealthDocument(dataset, DataFactory);
    expect([...document.workouts][0]?.activityType).toBe("Run");
    const workout = [...document.workouts][0];
    assert(workout);
    expect(document.orderedPoints(workout)[0]?.sequence).toBe(0);
    await expect(toTurtle(document)).rejects.toThrow(
      "Turtle serialization requires the default graph",
    );
    const defaultGraph = document.match(
      undefined,
      undefined,
      undefined,
      DataFactory.defaultGraph(),
    );
    const output = await toTurtle(defaultGraph);
    expect(() => new Parser({ format: "text/turtle" }).parse(output)).not.toThrow();
    expect(output).toContain(`"${health}Observation"`);
  });

  it.each(aliases(NS.HEALTH))("locates %s registrations and writes canonical classes", (health) => {
    const dataset = parse(`@prefix solid: <${NS.SOLID}> .
      [] a solid:TypeRegistration ; solid:forClass <${health}HealthRecord> ; solid:instanceContainer <urn:records> .
      [] a solid:TypeRegistration .`);
    const index = new TypeIndexDataset(dataset, DataFactory);
    expect(index.locate(HealthClass.HealthRecord)).toEqual([{ container: "urn:records" }]);
    expect(index.locate(`${health}HealthRecord`)).toHaveLength(1);
    expect(
      index.register("urn:index", "#new", `${health}HealthRecord`, { container: "urn:records" })
        .forClass,
    ).toBe(HealthClass.HealthRecord);
  });
});
