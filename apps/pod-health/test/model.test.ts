// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { DataFactory, Parser, Store } from "n3";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CodeableConcept,
  type Condition,
  HealthDocument,
  type HealthRecord,
  Immunization,
  Instant,
  MedicationStatement,
  MedicinalProduct,
  Observation,
  type ObservationKind,
  RoutePoint,
  Workout,
} from "../src/model.js";
import {
  CoreProp,
  GeoProp,
  HealthClass,
  HealthProp,
  PhClass,
  PhProp,
  RDF_TYPE,
  TimeTerm,
  Unit,
} from "../src/vocab.js";
import { CONFORMANT_HEALTH_TTL } from "./fixtures.js";

function load(ttl: string): HealthDocument {
  const store = new Store(
    new Parser({ baseIRI: "https://carol.example/health/Record" }).parse(ttl),
  );
  return new HealthDocument(store, DataFactory);
}

function empty(): HealthDocument {
  return new HealthDocument(new Store(), DataFactory);
}

describe("HealthDocument — reading the conformant instance", () => {
  let doc: HealthDocument;
  beforeEach(() => {
    doc = load(CONFORMANT_HEALTH_TTL);
  });

  it("lists the one health record and its subject + provider + entries", () => {
    const records = [...doc.records];
    expect(records).toHaveLength(1);
    const rec = records[0] as HealthRecord;
    expect(rec.patientSubject).toBe("https://carol.example/health/Carol");
    expect(rec.careProvider).toBe("https://carol.example/health/Clinic");
    expect([...rec.entries].sort()).toEqual([
      "https://carol.example/health/Cond1",
      "https://carol.example/health/HR1",
    ]);
    expect([...rec.types]).toContain(HealthClass.HealthRecord);
  });

  it("lists the heart-rate observation with code, value, unit, time", () => {
    const obs = [...doc.observations];
    expect(obs).toHaveLength(1);
    const hr = obs[0] as Observation;
    expect(hr.kind).toBe("HeartRate");
    expect(hr.patient).toBe("https://carol.example/health/Carol");
    expect(hr.code).toBe("https://carol.example/health/LoincHeartRate");
    expect(hr.measuredValue).toBe(72);
    expect(hr.unit).toBe(Unit.beatPerMin);
    expect(hr.unitCode).toBe("/min");
    expect(hr.effectiveTime).toBe("https://carol.example/health/T1");
  });

  it("resolves the codeable concepts", () => {
    const concepts = [...doc.codeableConcepts];
    const codes = concepts.map((c) => c.code).sort();
    expect(codes).toEqual(["38341003", "8867-4"]);
  });

  it("reads the instant timestamp through the Instant wrapper", () => {
    const t1 = doc.instant("https://carol.example/health/T1");
    expect(t1.dateTime?.toISOString()).toBe("2026-06-13T08:00:00.000Z");
  });

  it("lists the condition", () => {
    const conds = [...doc.conditions];
    expect(conds).toHaveLength(1);
    const c = conds[0] as Condition;
    expect(c.patient).toBe("https://carol.example/health/Carol");
    expect(c.code).toBe("https://carol.example/health/SctHypertension");
  });
});

describe("Observation — kind transitions and round-trip", () => {
  it("mints each observation subtype and reads the kind back", () => {
    const kinds: ObservationKind[] = ["Observation", "HeartRate", "StepCount", "Sleep"];
    for (const kind of kinds) {
      const doc = empty();
      const obs = doc.mintObservation("urn:obs", kind);
      expect(obs.kind).toBe(kind);
      expect([...obs.types]).toContain(HealthClass.Observation);
    }
  });

  it("clears the previous subtype when the kind changes", () => {
    const doc = empty();
    const obs = doc.mintObservation("urn:obs", "HeartRate");
    expect([...obs.types]).toContain(HealthClass.HeartRateObservation);
    obs.kind = "StepCount";
    expect(obs.kind).toBe("StepCount");
    expect([...obs.types]).not.toContain(HealthClass.HeartRateObservation);
    expect([...obs.types]).toContain(HealthClass.StepCountObservation);
    obs.kind = "Observation";
    expect(obs.kind).toBe("Observation");
    expect([...obs.types]).not.toContain(HealthClass.StepCountObservation);
  });

  it("kind is undefined when the node carries no observation type", () => {
    const doc = empty();
    const obs = new Observation("urn:nope", doc, DataFactory);
    expect(obs.kind).toBeUndefined();
  });

  it("Sleep wins over a bare Observation in kind precedence", () => {
    const doc = empty();
    const obs = doc.mintObservation("urn:o");
    obs.types.add(HealthClass.SleepObservation);
    expect(obs.kind).toBe("Sleep");
  });

  it("round-trips every field including undefined-clears", () => {
    const doc = empty();
    const obs = doc.mintObservation("urn:hr", "HeartRate");
    obs.patient = "urn:carol";
    obs.code = "urn:loinc";
    obs.measuredValue = 72;
    obs.unit = Unit.beatPerMin;
    obs.unitCode = "/min";
    obs.effectiveTime = "urn:t1";

    expect(obs.patient).toBe("urn:carol");
    expect(obs.code).toBe("urn:loinc");
    expect(obs.measuredValue).toBe(72);
    expect(obs.unit).toBe(Unit.beatPerMin);
    expect(obs.unitCode).toBe("/min");
    expect(obs.effectiveTime).toBe("urn:t1");

    obs.patient = undefined;
    obs.code = undefined;
    obs.measuredValue = undefined;
    obs.unit = undefined;
    obs.unitCode = undefined;
    obs.effectiveTime = undefined;
    expect(obs.patient).toBeUndefined();
    expect(obs.code).toBeUndefined();
    expect(obs.measuredValue).toBeUndefined();
    expect(obs.unit).toBeUndefined();
    expect(obs.unitCode).toBeUndefined();
    expect(obs.effectiveTime).toBeUndefined();
  });

  it("markObservation stamps the base class", () => {
    const doc = empty();
    const obs = new Observation("urn:o", doc, DataFactory);
    obs.markObservation();
    expect([...obs.types]).toEqual([HealthClass.Observation]);
  });
});

describe("Instant", () => {
  it("round-trips a dateTime and clears it", () => {
    const doc = empty();
    const inst = doc.mintInstant("urn:t");
    expect([...inst.types]).toContain(TimeTerm.Instant);
    const when = new Date("2026-01-02T03:04:05Z");
    inst.dateTime = when;
    expect(inst.dateTime?.toISOString()).toBe(when.toISOString());
    inst.dateTime = undefined;
    expect(inst.dateTime).toBeUndefined();
  });
});

describe("CodeableConcept", () => {
  it("round-trips code + scheme", () => {
    const doc = empty();
    const cc = doc.mintCodeableConcept("urn:cc");
    expect([...cc.types]).toContain(HealthClass.CodeableConcept);
    cc.code = "8867-4";
    cc.scheme = "https://loinc.org/";
    expect(cc.code).toBe("8867-4");
    expect(cc.scheme).toBe("https://loinc.org/");
    cc.code = undefined;
    cc.scheme = undefined;
    expect(cc.code).toBeUndefined();
    expect(cc.scheme).toBeUndefined();
  });
});

describe("Condition", () => {
  it("round-trips patient + code", () => {
    const doc = empty();
    const c = doc.mintCondition("urn:c");
    expect([...c.types]).toContain(HealthClass.Condition);
    c.patient = "urn:carol";
    c.code = "urn:snomed";
    expect(c.patient).toBe("urn:carol");
    expect(c.code).toBe("urn:snomed");
    c.patient = undefined;
    c.code = undefined;
    expect(c.patient).toBeUndefined();
    expect(c.code).toBeUndefined();
  });
});

describe("MedicationStatement + MedicinalProduct", () => {
  it("round-trips patient + medication and marks the product", () => {
    const doc = empty();
    const ms = doc.mintMedicationStatement("urn:ms");
    expect([...ms.types]).toContain(HealthClass.MedicationStatement);
    ms.patient = "urn:carol";
    ms.medication = "urn:drug";
    expect(ms.patient).toBe("urn:carol");
    expect(ms.medication).toBe("urn:drug");
    ms.patient = undefined;
    ms.medication = undefined;
    expect(ms.patient).toBeUndefined();
    expect(ms.medication).toBeUndefined();

    const prod = doc.mintMedicinalProduct("urn:drug");
    expect([...prod.types]).toContain(HealthClass.MedicinalProduct);
    expect([...doc.medicinalProducts]).toHaveLength(1);
    expect([...doc.medicationStatements]).toHaveLength(1);
  });
});

describe("HealthDocument — listing every modelled class", () => {
  it("iterates all the instancesOf-backed getters", () => {
    const doc = empty();
    doc.mintHealthRecord("urn:rec");
    doc.mintObservation("urn:obs");
    doc.mintCondition("urn:cond");
    doc.mintMedicationStatement("urn:ms");
    doc.mintImmunization("urn:im");
    doc.mintMedicinalProduct("urn:prod");
    doc.mintCodeableConcept("urn:cc");
    doc.mintWorkout("urn:w");
    doc.mintRoutePoint("urn:rp");

    expect([...doc.records]).toHaveLength(1);
    expect([...doc.observations]).toHaveLength(1);
    expect([...doc.conditions]).toHaveLength(1);
    expect([...doc.medicationStatements]).toHaveLength(1);
    expect([...doc.immunizations]).toHaveLength(1);
    expect([...doc.medicinalProducts]).toHaveLength(1);
    expect([...doc.codeableConcepts]).toHaveLength(1);
    expect([...doc.workouts]).toHaveLength(1);
    expect([...doc.routePoints]).toHaveLength(1);
  });
});

describe("Immunization", () => {
  it("round-trips patient + vaccine", () => {
    const doc = empty();
    const im = doc.mintImmunization("urn:im");
    expect([...im.types]).toContain(HealthClass.Immunization);
    im.patient = "urn:carol";
    im.vaccine = "urn:vax";
    expect(im.patient).toBe("urn:carol");
    expect(im.vaccine).toBe("urn:vax");
    im.patient = undefined;
    im.vaccine = undefined;
    expect(im.patient).toBeUndefined();
    expect(im.vaccine).toBeUndefined();
  });
});

describe("HealthRecord", () => {
  it("round-trips subject + provider + entries set", () => {
    const doc = empty();
    const rec = doc.mintHealthRecord("urn:rec");
    expect([...rec.types]).toContain(HealthClass.HealthRecord);
    rec.patientSubject = "urn:carol";
    rec.careProvider = "urn:clinic";
    rec.entries.add("urn:e1");
    rec.entries.add("urn:e2");
    expect(rec.patientSubject).toBe("urn:carol");
    expect(rec.careProvider).toBe("urn:clinic");
    expect([...rec.entries].sort()).toEqual(["urn:e1", "urn:e2"]);
    rec.entries.delete("urn:e1");
    expect([...rec.entries]).toEqual(["urn:e2"]);
    rec.patientSubject = undefined;
    rec.careProvider = undefined;
    expect(rec.patientSubject).toBeUndefined();
    expect(rec.careProvider).toBeUndefined();
  });
});

describe("Workout + RoutePoint", () => {
  it("mints a workout and round-trips all fields", () => {
    const doc = empty();
    const w = doc.mintWorkout("urn:w");
    expect([...w.types]).toContain(PhClass.Workout);
    w.patient = "urn:carol";
    w.activityType = "Ride";
    const start = new Date("2026-06-13T07:00:00Z");
    const end = new Date("2026-06-13T08:00:00Z");
    w.startTime = start;
    w.endTime = end;
    w.distance = 12345.6;
    w.points.add("urn:p0");
    w.points.add("urn:p1");

    expect(w.patient).toBe("urn:carol");
    expect(w.activityType).toBe("Ride");
    expect(w.startTime?.toISOString()).toBe(start.toISOString());
    expect(w.endTime?.toISOString()).toBe(end.toISOString());
    expect(w.distance).toBeCloseTo(12345.6, 1);
    expect([...w.points].sort()).toEqual(["urn:p0", "urn:p1"]);

    w.patient = undefined;
    w.activityType = undefined;
    w.startTime = undefined;
    w.endTime = undefined;
    w.distance = undefined;
    expect(w.patient).toBeUndefined();
    expect(w.activityType).toBeUndefined();
    expect(w.startTime).toBeUndefined();
    expect(w.endTime).toBeUndefined();
    expect(w.distance).toBeUndefined();
  });

  it("mints a route point and round-trips lat/long/elevation/time/sequence", () => {
    const doc = empty();
    const p = doc.mintRoutePoint("urn:p");
    expect([...p.types]).toContain(PhClass.RoutePoint);
    p.sequence = 3;
    p.lat = 51.5;
    p.long = -0.12;
    p.elevation = 14.2;
    const t = new Date("2026-06-13T07:00:30Z");
    p.time = t;

    expect(p.sequence).toBe(3);
    expect(p.lat).toBe(51.5);
    expect(p.long).toBe(-0.12);
    expect(p.elevation).toBe(14.2);
    expect(p.time?.toISOString()).toBe(t.toISOString());

    p.elevation = undefined;
    p.time = undefined;
    p.sequence = undefined;
    p.lat = undefined;
    p.long = undefined;
    expect(p.elevation).toBeUndefined();
    expect(p.time).toBeUndefined();
    expect(p.sequence).toBeUndefined();
    expect(p.lat).toBeUndefined();
    expect(p.long).toBeUndefined();
  });

  it("orders route points by sequence, then by IRI for ties / missing sequence", () => {
    const doc = empty();
    const w = doc.mintWorkout("urn:w");
    const p2 = doc.mintRoutePoint("urn:b-p");
    p2.sequence = 2;
    const p0 = doc.mintRoutePoint("urn:a-p");
    p0.sequence = 0;
    const pNoSeqA = doc.mintRoutePoint("urn:y-nope");
    const pNoSeqB = doc.mintRoutePoint("urn:z-nope");
    for (const p of [p2, p0, pNoSeqB, pNoSeqA]) w.points.add(p.value);

    const ordered = doc.orderedPoints(w).map((p) => p.value);
    expect(ordered).toEqual(["urn:a-p", "urn:b-p", "urn:y-nope", "urn:z-nope"]);
  });

  it("orders two missing-sequence points deterministically by IRI", () => {
    const doc = empty();
    const w = doc.mintWorkout("urn:w");
    const later = doc.mintRoutePoint("urn:zzz");
    const earlier = doc.mintRoutePoint("urn:aaa");
    w.points.add(later.value);
    w.points.add(earlier.value);
    const ordered = doc.orderedPoints(w).map((p) => p.value);
    expect(ordered).toEqual(["urn:aaa", "urn:zzz"]);
  });

  it("returns a single point unchanged (comparator not exercised)", () => {
    const doc = empty();
    const w = doc.mintWorkout("urn:w");
    const p = doc.mintRoutePoint("urn:same");
    w.points.add(p.value);
    expect(doc.orderedPoints(w).map((x) => x.value)).toEqual(["urn:same"]);
  });
});

describe("HealthDocument resolution helpers", () => {
  it("wraps existing subjects via the helper accessors", () => {
    const doc = load(CONFORMANT_HEALTH_TTL);
    expect(doc.observation("https://carol.example/health/HR1").kind).toBe("HeartRate");
    expect(doc.codeableConcept("https://carol.example/health/LoincHeartRate").code).toBe("8867-4");
    expect(doc.instant("https://carol.example/health/T1").dateTime?.toISOString()).toBe(
      "2026-06-13T08:00:00.000Z",
    );
    expect(doc.routePoint("urn:none").lat).toBeUndefined();
  });
});

describe("vocab — every term is namespaced (no bare/relative IRI)", () => {
  it("uses absolute http(s) IRIs everywhere", () => {
    const all = [
      ...Object.values(HealthClass),
      ...Object.values(HealthProp),
      ...Object.values(CoreProp),
      ...Object.values(TimeTerm),
      ...Object.values(Unit),
      ...Object.values(PhClass),
      ...Object.values(PhProp),
      ...Object.values(GeoProp),
      RDF_TYPE,
    ];
    for (const iri of all) {
      expect(iri).toMatch(/^https?:\/\//);
    }
  });
});
