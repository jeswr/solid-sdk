// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  assertFhirBundle,
  buildFhirBundle,
  CATEGORY_SYSTEM,
  FhirExportError,
  type FhirExportOptions,
  type HealthRecords,
  LOINC_SYSTEM,
  MAX_FHIR_RECORDS,
  type ObservationInput,
  serialiseFhirBundle,
  UCUM_SYSTEM,
} from "../src/apps/health/lib/fhir";

const at = "2026-10-01T12:00:00Z";
const observation = {
  id: "obs-1",
  metric: "weight",
  value: 72.5,
  unit: "kg",
  effective: at,
  source: "Fictional example.org scale",
} as const;
const medication = {
  id: "med-1",
  name: "Fictional Example Medicine",
  dosageText: "One fictional tablet daily",
  start: "2026-09-01",
} as const;
const condition = {
  id: "condition-1",
  name: "Fictional example condition",
  onset: "2026-08-01",
} as const;

function records(overrides: Partial<HealthRecords> = {}): HealthRecords {
  return { observations: [], medications: [], conditions: [], ...overrides };
}

function options(patientReference?: string): FhirExportOptions {
  let sequence = 0;
  return {
    clock: () => new Date("2026-10-26T12:00:00.000Z"),
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ...(patientReference === undefined ? {} : { patientReference }),
  };
}

function build(input: unknown, injected: unknown = options()) {
  return buildFhirBundle(input as HealthRecords, injected as FhirExportOptions);
}

function expectCode(action: () => unknown, code: FhirExportError["code"]): void {
  expect(action).toThrow(FhirExportError);
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ name: "FhirExportError", code });
  }
}

const table = [
  ["weight", "29463-7", "kg", "vital-signs"],
  ["height", "8302-2", "cm", "vital-signs"],
  ["heartRate", "8867-4", "/min", "vital-signs"],
  ["steps", "55423-8", "{steps}", "activity"],
  ["bodyTemperature", "8310-5", "Cel", "vital-signs"],
  ["oxygenSaturation", "59408-5", "%", "vital-signs"],
] as const;

describe("health FHIR R4 collection export", () => {
  it("exports an empty collection with one injected timestamp and no UUID calls", () => {
    const injected = { clock: vi.fn(options().clock), uuid: vi.fn(options().uuid) };
    expect(buildFhirBundle(records(), injected)).toEqual({
      resourceType: "Bundle",
      type: "collection",
      timestamp: "2026-10-26T12:00:00.000Z",
    });
    expect(injected.clock).toHaveBeenCalledTimes(1);
    expect(injected.uuid).not.toHaveBeenCalled();
    expect(() => assertFhirBundle(buildFhirBundle(records(), options()))).not.toThrow();
  });

  it.each(
    table,
  )("maps %s only to its specified LOINC/UCUM pair", (metric, code, unit, category) => {
    const input = records({ observations: [{ ...observation, metric, unit, value: 37.25 }] });
    const bundle = buildFhirBundle(
      input,
      options("https://example.org/fhir/Patient/fictional-patient"),
    );
    expect(bundle.entry).toEqual([
      {
        fullUrl: "urn:uuid:00000000-0000-4000-8000-000000000001",
        resource: {
          resourceType: "Observation",
          id: "obs-1",
          status: "final",
          category: [{ coding: [{ system: CATEGORY_SYSTEM, code: category }] }],
          code: { coding: [{ system: LOINC_SYSTEM, code }] },
          subject: { reference: "https://example.org/fhir/Patient/fictional-patient" },
          effectiveDateTime: at,
          note: [{ text: "Source: Fictional example.org scale" }],
          valueQuantity: { value: 37.25, unit, system: UCUM_SYSTEM, code: unit },
        },
      },
    ]);
    assertFhirBundle(bundle);
    expectCode(
      () => build(records({ observations: [{ ...observation, metric, unit: `${unit} ` }] })),
      "UNIT_MISMATCH",
    );
  });

  it("emits one blood-pressure panel with exactly two ordered components", () => {
    const bundle = buildFhirBundle(
      records({
        observations: [
          {
            ...observation,
            metric: "bloodPressure",
            unit: "mm[Hg]",
            value: { systolic: 120, diastolic: 80 },
          },
        ],
      }),
      options(),
    );
    expect(bundle.entry?.[0]?.resource).toEqual({
      resourceType: "Observation",
      id: "obs-1",
      status: "final",
      category: [{ coding: [{ system: CATEGORY_SYSTEM, code: "vital-signs" }] }],
      code: { coding: [{ system: LOINC_SYSTEM, code: "85354-9" }] },
      effectiveDateTime: at,
      note: [{ text: "Source: Fictional example.org scale" }],
      component: [
        {
          code: { coding: [{ system: LOINC_SYSTEM, code: "8480-6" }] },
          valueQuantity: { value: 120, unit: "mm[Hg]", system: UCUM_SYSTEM, code: "mm[Hg]" },
        },
        {
          code: { coding: [{ system: LOINC_SYSTEM, code: "8462-4" }] },
          valueQuantity: { value: 80, unit: "mm[Hg]", system: UCUM_SYSTEM, code: "mm[Hg]" },
        },
      ],
    });
    assertFhirBundle(bundle);
    expectCode(
      () =>
        build({
          ...records(),
          observations: [{ ...observation, metric: "bloodPressure", unit: "mmHg" }],
        }),
      "UNIT_MISMATCH",
    );
  });

  it.each([
    120,
    "120/80",
    null,
    {},
    { systolic: 120 },
    { systolic: NaN, diastolic: 80 },
    { systolic: 120, diastolic: Infinity },
    { systolic: 120, diastolic: 80, extra: true },
  ])("rejects incomplete or ambiguous blood pressure %j", (value) => {
    expectCode(
      () =>
        build({
          ...records(),
          observations: [{ ...observation, metric: "bloodPressure", unit: "mm[Hg]", value }],
        }),
      "INVALID_INPUT",
    );
  });

  it("preserves medication and condition text, periods and unknown status", () => {
    const bundle = buildFhirBundle(
      records({
        medications: [medication, { ...medication, id: "med-2", end: "2026-09-30" }],
        conditions: [condition],
      }),
      options("https://example.org/fhir/Patient/fictional-patient"),
    );
    expect(bundle.entry?.map((entry) => entry.resource)).toEqual([
      {
        resourceType: "Condition",
        id: "condition-1",
        code: { text: condition.name },
        subject: { reference: "https://example.org/fhir/Patient/fictional-patient" },
        onsetDateTime: condition.onset,
      },
      {
        resourceType: "MedicationStatement",
        id: "med-1",
        status: "unknown",
        medicationCodeableConcept: { text: medication.name },
        subject: { reference: "https://example.org/fhir/Patient/fictional-patient" },
        effectivePeriod: { start: medication.start },
        dosage: [{ text: medication.dosageText }],
      },
      {
        resourceType: "MedicationStatement",
        id: "med-2",
        status: "unknown",
        medicationCodeableConcept: { text: medication.name },
        subject: { reference: "https://example.org/fhir/Patient/fictional-patient" },
        effectivePeriod: { start: medication.start, end: "2026-09-30" },
        dosage: [{ text: medication.dosageText }],
      },
    ]);
    assertFhirBundle(bundle);
  });

  it("does not invent a Patient reference when no reference is supplied", () => {
    const bundle = buildFhirBundle(
      records({ observations: [observation], medications: [medication], conditions: [condition] }),
      options(),
    );
    expect(bundle.entry?.map((entry) => entry.resource.subject)).toEqual([
      { display: "Patient not supplied" },
      { display: "Patient not supplied" },
      undefined,
    ]);
    expect(JSON.stringify(bundle)).not.toContain('"reference"');
    expect(bundle.entry).toHaveLength(3);
    assertFhirBundle(bundle);
  });

  it.each([
    "http://example.org/Patient/fictional-person",
    "https://example.org/fhir/r4/Patient/fictional-person",
  ])("preserves an absolute patient reference on every record kind: %s", (reference) => {
    const bundle = buildFhirBundle(
      records({ observations: [observation], medications: [medication], conditions: [condition] }),
      options(reference),
    );
    expect(bundle.entry?.map((entry) => entry.resource.subject)).toEqual([
      { reference },
      { reference },
      { reference },
    ]);
    assertFhirBundle(JSON.parse(JSON.stringify(bundle)));
  });

  it.each([
    "fictional-person",
    "Patient/fictional-person",
    "urn:uuid:00000000-0000-4000-8000-000000000001",
    "ftp://example.org/Patient/a",
    "https://[invalid]/Patient/a",
    "https://example.org/Practitioner/a",
    "https://example.org/Patient/bad/id",
    `https://example.org/Patient/${"a".repeat(65)}`,
    "https://example.org/Patient/a?query=1",
    "https://example.org/Patient/a#fragment",
    "https://user@example.org/Patient/a",
    "https://:password@example.org/Patient/a",
    "https://EXAMPLE.org/Patient/a",
  ])("rejects unsupported patient reference %s before callbacks", (reference) => {
    const injected = {
      ...options(reference),
      clock: vi.fn(options().clock),
      uuid: vi.fn(options().uuid),
    };
    expectCode(() => build(records(), injected), "INVALID_OPTIONS");
    expect(injected.clock).not.toHaveBeenCalled();
    expect(injected.uuid).not.toHaveBeenCalled();
  });

  it("rejects legacy patientId rather than emitting an unresolvable relative reference", () => {
    expectCode(
      () => build(records(), { ...options(), patientId: "fictional-person" }),
      "INVALID_OPTIONS",
    );
  });

  it("sorts by kind, real instant and code-unit ID before assigning UUIDs", () => {
    const input = records({
      observations: [
        { ...observation, id: "later", effective: "2026-10-01T12:00:00-01:00" },
        { ...observation, id: "z", effective: "2026-10-01T14:00:00+02:00" },
        { ...observation, id: "a" },
        { ...observation, id: "A" },
      ],
      conditions: [{ ...condition, id: "c2", onset: "2026-08-02" }, condition],
      medications: [{ ...medication, id: "m2", start: "2026-09-02" }, medication],
    });
    const first = serialiseFhirBundle(input, options());
    const reordered = records({
      observations: [...input.observations].reverse().map((entry) => {
        const { id, ...fields } = entry;
        return { ...fields, id };
      }),
      conditions: [...input.conditions].reverse(),
      medications: [...input.medications].reverse(),
    });
    expect(serialiseFhirBundle(reordered, options())).toBe(first);
    expect(
      JSON.parse(first).entry?.map((entry: { resource: { id: string } }) => entry.resource.id),
    ).toEqual(["condition-1", "c2", "med-1", "m2", "A", "a", "z", "later"]);
    expect(
      serialiseFhirBundle(records({ observations: [observation] }), options()),
    ).toMatchInlineSnapshot(
      `"{"resourceType":"Bundle","type":"collection","timestamp":"2026-10-26T12:00:00.000Z","entry":[{"fullUrl":"urn:uuid:00000000-0000-4000-8000-000000000001","resource":{"resourceType":"Observation","id":"obs-1","status":"final","category":[{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/observation-category","code":"vital-signs"}]}],"code":{"coding":[{"system":"http://loinc.org","code":"29463-7"}]},"effectiveDateTime":"2026-10-01T12:00:00Z","note":[{"text":"Source: Fictional example.org scale"}],"valueQuantity":{"value":72.5,"unit":"kg","system":"http://unitsofmeasure.org","code":"kg"}}}]}"`,
    );
  });

  it("returns independent resources and does not mutate frozen input", () => {
    const pair = Object.freeze({ systolic: 120, diastolic: 80 });
    const obs = Object.freeze({
      ...observation,
      metric: "bloodPressure" as const,
      unit: "mm[Hg]",
      value: pair,
    });
    const input = Object.freeze(
      records({
        observations: Object.freeze([obs]),
        medications: Object.freeze([medication]),
        conditions: Object.freeze([condition]),
      }),
    );
    const bundle = buildFhirBundle(input, options());
    const panel = bundle.entry?.[2]?.resource;
    if (panel?.resourceType !== "Observation" || !panel.component)
      throw new Error("Expected panel");
    panel.component[0].valueQuantity.value = 90;
    expect(pair.systolic).toBe(120);
    expect(buildFhirBundle(input, options()).entry?.[2]?.resource).not.toEqual(panel);
  });

  it.each([
    "sleep",
    "systolic",
    "diastolic",
    "body weight",
    "Weight",
    "constructor",
    "__proto__",
    "",
    null,
    29463,
  ])("rejects unsupported metric %j", (metric) => {
    expectCode(
      () => build({ ...records(), observations: [{ ...observation, metric }] }),
      "UNSUPPORTED_METRIC",
    );
  });

  it.each(["lb", "g", "KG", null, 1])("rejects mismatched unit %j without converting", (unit) => {
    expectCode(
      () => build({ ...records(), observations: [{ ...observation, unit }] }),
      "UNIT_MISMATCH",
    );
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "72",
    null,
    {},
    undefined,
  ])("rejects nonrepresentable scalar %j", (value) => {
    expectCode(
      () => build({ ...records(), observations: [{ ...observation, value }] }),
      "INVALID_INPUT",
    );
  });

  it.each([
    "2026-02-30T12:00:00Z",
    "2026-13-01T12:00:00Z",
    "2026-10-01",
    "2026-10-01T12:00:00",
    "2026-10-01T24:00:00Z",
    "2026-10-01T12:60:00Z",
    "2026-10-01T12:00:60Z",
    "2026-10-01T12:00:00.0001Z",
    "2026-10-01T12:00:00+14:01",
    "0000-10-01T12:00:00Z",
    "tomorrow",
    null,
  ])("rejects invalid observation effective date %j", (effective) => {
    expectCode(
      () => build({ ...records(), observations: [{ ...observation, effective }] }),
      "INVALID_INPUT",
    );
  });

  it.each([
    "0001-01-01T00:00:00Z",
    "9999-12-31T23:59:59.999Z",
    "2024-02-29T12:00:00.1+14:00",
    "2026-10-01T12:00:00.12-14:00",
    "2026-10-01T12:00:00+05:30",
  ])("preserves valid ISO timestamp %s", (effective) => {
    const bundle = buildFhirBundle(
      records({ observations: [{ ...observation, effective }] }),
      options(),
    );
    expect(bundle.entry?.[0]?.resource).toHaveProperty("effectiveDateTime", effective);
    assertFhirBundle(bundle);
  });

  it.each([
    {},
    { id: "" },
    { id: "https://example.org/record" },
    { id: "a".repeat(65) },
    { id: 1 },
    { source: " " },
    { source: null },
    { extra: true },
    { effective: new Date() },
  ])("rejects malformed observation fields %j", (change) => {
    const value = Object.keys(change).length === 0 ? {} : { ...observation, ...change };
    expectCode(() => build({ ...records(), observations: [value] }), "INVALID_INPUT");
  });

  it("accepts the FHIR logical-ID length boundary and non-clinically interpreted values", () => {
    for (const value of [0, -1, Number.MAX_SAFE_INTEGER]) {
      const bundle = buildFhirBundle(
        records({ observations: [{ ...observation, id: "a".repeat(64), value }] }),
        options(`https://example.org/Patient/${"a".repeat(64)}`),
      );
      assertFhirBundle(bundle);
    }
  });

  it.each([
    { name: "" },
    { dosageText: null },
    { start: "2026-02-29" },
    { end: "2026-08-31" },
    { end: undefined },
    { end: "invalid" },
    { extra: true },
  ])("rejects malformed medication %j", (change) => {
    expectCode(
      () => build({ ...records(), medications: [{ ...medication, ...change }] }),
      "INVALID_INPUT",
    );
  });

  it.each([
    { name: "" },
    { onset: "2026-02-29" },
    { onset: null },
    { extra: true },
  ])("rejects malformed condition %j", (change) => {
    expectCode(
      () => build({ ...records(), conditions: [{ ...condition, ...change }] }),
      "INVALID_INPUT",
    );
  });

  it("accepts equal period endpoints and datetime clinical dates", () => {
    const bundle = buildFhirBundle(
      records({
        medications: [{ ...medication, start: at, end: at }],
        conditions: [{ ...condition, onset: at }],
      }),
      options(),
    );
    assertFhirBundle(bundle);
  });

  it.each([
    null,
    [],
    { observations: [], medications: [] },
    { ...records(), conditions: null },
    { ...records(), observations: {} },
    { ...records(), extra: true },
    new Date(),
  ])("rejects malformed top-level input %j", (input) => {
    expectCode(() => build(input), "INVALID_INPUT");
  });

  it("rejects sparse, accessor, decorated and custom arrays without calling getters", () => {
    const getter = vi.fn(() => observation);
    const accessor = Object.defineProperty([], 0, { get: getter, enumerable: true });
    const custom = [observation];
    Object.setPrototypeOf(custom, {});
    const hidden = Object.defineProperty([observation], 0, { enumerable: false });
    for (const observations of [
      new Array(1),
      accessor,
      custom,
      hidden,
      Object.assign([observation], { extra: 1 }),
    ]) {
      expectCode(() => build({ ...records(), observations }), "INVALID_INPUT");
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects non-data/hidden/symbol fields and accepts null-prototype records", () => {
    const getter = vi.fn(() => "weight");
    for (const value of [
      null,
      [],
      Object.assign(Object.create({ inherited: true }), observation),
      Object.defineProperty({ ...observation }, "metric", { get: getter }),
      Object.defineProperty({ ...observation }, "source", { enumerable: false }),
      { ...observation, [Symbol("extra")]: 1 },
    ])
      expectCode(() => build({ ...records(), observations: [value] }), "INVALID_INPUT");
    expect(getter).not.toHaveBeenCalled();
    const plain = Object.assign(Object.create(null), observation);
    assertFhirBundle(build({ ...records(), observations: [plain] }));
  });

  it("rejects duplicate IDs within each resource kind, allowing IDs shared across kinds", () => {
    for (const input of [
      records({ observations: [observation, observation] }),
      records({ medications: [medication, medication] }),
      records({ conditions: [condition, condition] }),
    ])
      expectCode(() => build(input), "INVALID_INPUT");
    assertFhirBundle(
      buildFhirBundle(
        records({
          observations: [{ ...observation, id: "same" }],
          medications: [{ ...medication, id: "same" }],
          conditions: [{ ...condition, id: "same" }],
        }),
        options(),
      ),
    );
  });

  it.each([
    null,
    {},
    { clock: () => new Date(), uuid: null },
    { ...options(), clock: null },
    { ...options(), patientReference: undefined },
    { ...options(), patientReference: "" },
    { ...options(), patientReference: "https://example.org/person" },
    { ...options(), extra: true },
  ])("rejects invalid options", (injected) => {
    expectCode(() => build(records(), injected), "INVALID_OPTIONS");
  });

  it.each([
    undefined,
    "2026-10-26",
    new Date(NaN),
    new Date("+010000-01-01T00:00:00Z"),
  ])("rejects invalid clock result %j", (now) => {
    expectCode(() => build(records(), { ...options(), clock: () => now }), "INVALID_OPTIONS");
  });

  it("uses the clock's Date value and wraps invalid Date receivers", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    now.toISOString = () => {
      throw new Error("Must not use overridden formatting");
    };
    expect(buildFhirBundle(records(), { ...options(), clock: () => now }).timestamp).toBe(
      "2026-10-26T12:00:00.000Z",
    );
    const proxy = new Proxy(new Date(), {});
    expectCode(
      () => buildFhirBundle(records(), { ...options(), clock: () => proxy }),
      "INVALID_OPTIONS",
    );
  });

  it.each([
    undefined,
    "not-a-uuid",
    42,
    "00000000-0000-4000-7000-000000000001",
  ])("rejects invalid UUID result %j", (generated) => {
    expectCode(
      () =>
        build(records({ observations: [observation] }), { ...options(), uuid: () => generated }),
      "INVALID_OPTIONS",
    );
  });

  it("normalizes UUID hex case and rejects repeated UUIDs across kinds", () => {
    const generated = "ABCDEFAB-0000-4000-8000-000000000001";
    const injected = { ...options(), uuid: () => generated };
    expect(
      buildFhirBundle(records({ observations: [observation] }), injected).entry?.[0]?.fullUrl,
    ).toBe(`urn:uuid:${generated.toLowerCase()}`);
    expectCode(
      () =>
        buildFhirBundle(
          records({ observations: [observation], conditions: [condition] }),
          injected,
        ),
      "INVALID_OPTIONS",
    );
  });

  it("wraps callback failures and excludes exception details", () => {
    for (const field of ["clock", "uuid"]) {
      const injected = {
        ...options(),
        [field]: () => {
          throw new Error("private example input");
        },
      };
      expectCode(
        () => build(records({ observations: [observation] }), injected),
        "INVALID_OPTIONS",
      );
      expect(() => build(records({ observations: [observation] }), injected)).not.toThrow(
        "private example input",
      );
    }
  });

  it("validates all records before calling the clock or UUID generator", () => {
    const injected = { clock: vi.fn(options().clock), uuid: vi.fn(options().uuid) };
    expectCode(
      () => build({ ...records({ observations: [observation] }), conditions: [null] }, injected),
      "INVALID_INPUT",
    );
    expect(injected.clock).not.toHaveBeenCalled();
    expect(injected.uuid).not.toHaveBeenCalled();
  });

  it("accepts exactly 100,000 combined records and self-checks all emitted kinds", () => {
    expect(MAX_FHIR_RECORDS).toBe(100_000);
    const input = records({
      observations: Array.from(
        { length: 40_000 },
        (_, index): ObservationInput => ({ ...observation, id: `o-${index}` }),
      ),
      medications: Array.from({ length: 30_000 }, (_, index) => ({
        ...medication,
        id: `m-${index}`,
      })),
      conditions: Array.from({ length: 30_000 }, (_, index) => ({
        ...condition,
        id: `c-${index}`,
      })),
    });
    const bundle = buildFhirBundle(input, options());
    expect(bundle.entry).toHaveLength(MAX_FHIR_RECORDS);
    expect(bundle.entry?.[0]?.resource.resourceType).toBe("Condition");
    expect(bundle.entry?.[MAX_FHIR_RECORDS - 1]?.resource.resourceType).toBe("Observation");
    assertFhirBundle(bundle);
  });

  it.each([
    "observations",
    "medications",
    "conditions",
  ])("rejects 100,001 %s before element reads or callbacks", (field) => {
    const values = new Array(MAX_FHIR_RECORDS + 1);
    const getter = vi.fn(() => {
      throw new Error("Must not inspect elements");
    });
    Object.defineProperty(values, 0, { get: getter, enumerable: true });
    const injected = { clock: vi.fn(options().clock), uuid: vi.fn(options().uuid) };
    expectCode(() => build({ ...records(), [field]: values }, injected), "TOO_MANY_RECORDS");
    expect(getter).not.toHaveBeenCalled();
    expect(injected.clock).not.toHaveBeenCalled();
    expect(injected.uuid).not.toHaveBeenCalled();
  });

  it("applies the size limit to the sum, before validating even the first record", () => {
    expectCode(
      () =>
        build({
          observations: new Array(MAX_FHIR_RECORDS - 1),
          medications: [null],
          conditions: [null],
        }),
      "TOO_MANY_RECORDS",
    );
  });
});
