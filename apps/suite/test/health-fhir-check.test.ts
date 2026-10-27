// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  assertFhirBundle,
  buildFhirBundle,
  FhirExportError,
  MAX_FHIR_RECORDS,
  MAX_FHIR_STRING_LENGTH,
} from "../src/apps/health/lib/fhir";

/** All records and IDs are synthetic. Each test starts from a fresh valid export. */
function fixture(): Record<string, unknown> {
  let sequence = 0;
  return buildFhirBundle(
    {
      observations: [
        {
          id: "a",
          metric: "weight",
          value: 72.5,
          unit: "kg",
          effective: "2026-10-01T12:00:00Z",
          source: "example.org fictional scale",
        },
        {
          id: "b",
          metric: "bloodPressure",
          value: { systolic: 120, diastolic: 80 },
          unit: "mm[Hg]",
          effective: "2026-10-01T12:00:00Z",
          source: "example.org fictional cuff",
        },
      ],
      medications: [
        {
          id: "med",
          name: "Fictional medicine",
          dosageText: "Fictional dosage",
          start: "2026-09-01",
          end: "2026-09-30",
        },
      ],
      conditions: [{ id: "condition", name: "Fictional condition", onset: "2026-08-01" }],
    },
    {
      clock: () => new Date("2026-10-26T12:00:00Z"),
      uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
      patientReference: "https://example.org/fhir/Patient/fictional-person",
    },
  ) as unknown as Record<string, unknown>;
}

const remove = Symbol("remove");
function change(bundle: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  const key = keys.pop();
  if (key === undefined) throw new Error("Missing test path");
  const target = keys.reduce<Record<string, unknown>>(
    (node, part) => node[part] as Record<string, unknown>,
    bundle,
  );
  if (value === remove) delete target[key];
  else target[key] = value;
}

function rejects(input: unknown, code = "INVALID_BUNDLE"): void {
  try {
    assertFhirBundle(input);
    expect.fail("Expected invalid bundle rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(FhirExportError);
    expect(error).toMatchObject({ code });
  }
}

describe("FHIR structural self-check", () => {
  it("accepts JSON-parsed output and narrows unknown to the bundle type", () => {
    const value: unknown = JSON.parse(JSON.stringify(fixture()));
    assertFhirBundle(value);
    expect(value.type).toBe("collection");
    expect(value.entry?.map((entry) => entry.resource.resourceType)).toEqual([
      "Condition",
      "MedicationStatement",
      "Observation",
      "Observation",
    ]);
  });

  it.each([null, [], true, "{}", new Date()])("rejects non-bundle %j", (input) => rejects(input));

  it.each([
    ["resourceType", remove],
    ["type", remove],
    ["timestamp", remove],
    ["resourceType", "Patient"],
    ["type", "document"],
    ["timestamp", "2026-10-26"],
    ["timestamp", "2026-02-30T00:00:00Z"],
    ["extra", true],
    ["entry", null],
    ["entry", {}],
    ["entry", []],
    ["entry", new Array(1)],
    ["entry.0", null],
    ["entry.0.extra", true],
    ["entry.0.fullUrl", remove],
    ["entry.0.fullUrl", 42],
    ["entry.0.fullUrl", "https://example.org/resource"],
    ["entry.0.fullUrl", "urn:uuid:invalid"],
    ["entry.0.resource", remove],
    ["entry.0.resource", {}],
    ["entry.0.resource.id", remove],
    ["entry.0.resource.id", "bad/id"],
    ["entry.0.resource.resourceType", remove],
    ["entry.0.resource.resourceType", "Patient"],
    ["entry.0.resource.resourceType", Symbol("invalid kind")],
    [
      "entry.0.resource.resourceType",
      {
        toString: () => {
          throw new Error("Must not coerce");
        },
      },
    ],
  ])("rejects malformed envelope or identity at %s", (path, value) => {
    const bundle = fixture();
    change(bundle, path as string, value);
    rejects(bundle);
  });

  it("accepts an absent entry for empty collections but rejects an explicitly undefined one", () => {
    const bundle = fixture();
    delete bundle.entry;
    assertFhirBundle(bundle);
    change(bundle, "entry", undefined);
    rejects(bundle);
  });

  it("rejects duplicate UUIDs regardless of hex case", () => {
    const bundle = fixture();
    change(bundle, "entry.0.fullUrl", "urn:uuid:abcdefab-0000-4000-8000-000000000001");
    change(bundle, "entry.1.fullUrl", "urn:uuid:ABCDEFAB-0000-4000-8000-000000000001");
    rejects(bundle);
  });

  it("rejects duplicate IDs within a kind", () => {
    const bundle = fixture();
    change(bundle, "entry.3.resource.id", "a");
    rejects(bundle);
  });

  it.each([
    "status",
    "category",
    "code",
    "effectiveDateTime",
    "note",
    "valueQuantity",
  ])("requires scalar Observation.%s", (field) => {
    const bundle = fixture();
    change(bundle, `entry.2.resource.${field}`, remove);
    rejects(bundle);
  });

  it.each([
    ["status", "preliminary"],
    ["effectiveDateTime", "2026-10-01"],
    ["code", null],
    ["code.coding", []],
    [
      "code.coding",
      [
        { system: "http://loinc.org", code: "29463-7" },
        { system: "http://loinc.org", code: "29463-7" },
      ],
    ],
    ["code.coding.0.system", "https://example.org/not-loinc"],
    ["code.coding.0.code", "unsupported"],
    ["code.coding.0.extra", true],
    ["category", []],
    ["category.0.coding", []],
    ["category.0.coding.0.system", "https://example.org/not-category"],
    ["category.0.coding.0.code", "activity"],
    ["note", []],
    ["note.0", {}],
    ["note.0.text", " "],
    ["valueQuantity", null],
    ["valueQuantity.value", NaN],
    ["valueQuantity.value", "72.5"],
    ["valueQuantity.unit", "lb"],
    ["valueQuantity.system", "https://example.org/not-ucum"],
    ["valueQuantity.code", "g"],
    ["component", []],
    ["subject", null],
    ["subject", {}],
    ["subject", { reference: "Patient/a", display: "Patient not supplied" }],
    ["subject", { reference: 42 }],
    ["subject", { reference: "Patient/a" }],
    ["subject", { reference: "Practitioner/a" }],
    ["subject", { reference: "Patient/bad/id" }],
    ["subject", { reference: "https://example.org/Practitioner/a" }],
    ["subject", { reference: "https://example.org/Patient/a#fragment" }],
    ["subject", { display: "Invented patient" }],
  ])("rejects malformed Observation.%s", (path, value) => {
    const bundle = fixture();
    change(bundle, `entry.2.resource.${path}`, value);
    rejects(bundle);
  });

  it.each([
    ["component", remove],
    ["component", []],
    ["component", [{}]],
    ["component.0.code.coding.0.code", "8462-4"],
    ["component.1.code.coding.0.code", "8480-6"],
    ["component.0.valueQuantity", remove],
    ["component.1.valueQuantity.unit", "mmHg"],
    ["component.1.valueQuantity.system", "https://example.org/not-ucum"],
    [
      "valueQuantity",
      { value: 120, unit: "mm[Hg]", system: "http://unitsofmeasure.org", code: "mm[Hg]" },
    ],
  ])("rejects malformed blood-pressure panel %s", (path, value) => {
    const bundle = fixture();
    change(bundle, `entry.3.resource.${path}`, value);
    rejects(bundle);
  });

  it.each([
    "status",
    "medicationCodeableConcept",
    "subject",
    "effectivePeriod",
    "dosage",
  ])("requires MedicationStatement.%s", (field) => {
    const bundle = fixture();
    change(bundle, `entry.1.resource.${field}`, remove);
    rejects(bundle);
  });

  it.each([
    ["status", "active"],
    ["medicationCodeableConcept.text", ""],
    ["medicationCodeableConcept.text", null],
    ["effectivePeriod.start", "2026-02-30"],
    ["effectivePeriod.end", "2026-08-31"],
    ["effectivePeriod.end", "invalid"],
    ["effectivePeriod.end", undefined],
    ["dosage", []],
    ["dosage", [{ text: "" }]],
    ["code", { text: "Wrong resource field" }],
  ])("rejects malformed MedicationStatement.%s", (path, value) => {
    const bundle = fixture();
    change(bundle, `entry.1.resource.${path}`, value);
    rejects(bundle);
  });

  it.each(["code", "subject", "onsetDateTime"])("requires Condition.%s", (field) => {
    const bundle = fixture();
    change(bundle, `entry.0.resource.${field}`, remove);
    rejects(bundle);
  });

  it.each([
    ["2026-09-01T12:00:00Z", "2026-09-01", true],
    ["2026-09-01T23:59:59.999-14:00", "2026-09-01", true],
    ["2026-09-01", "2026-09-01T00:00:00+14:00", true],
    ["2026-09-01T12:00:00.999Z", "2026-09-01T14:00:00+02:00", true],
    ["2026-09-01T12:00:00.199Z", "2026-09-01T12:00:00.1Z", true],
    ["2026-09-01T12:00:00.129Z", "2026-09-01T12:00:00.12Z", true],
    ["2026-09-01T12:00:00.123Z", "2026-09-01T12:00:00.123Z", true],
    ["2026-09-02T00:00:00Z", "2026-09-01", false],
    ["2026-09-02", "2026-09-01T23:59:59-14:00", false],
    ["2026-09-01T12:00:01Z", "2026-09-01T14:00:00+02:00", false],
    ["2026-09-01T12:00:00.200Z", "2026-09-01T12:00:00.1Z", false],
    ["2026-09-01T12:00:00.130Z", "2026-09-01T12:00:00.12Z", false],
    ["2026-09-01T12:00:00.124Z", "2026-09-01T12:00:00.123Z", false],
  ])("checks period precision independently: %s to %s (valid=%s)", (start, end, accepted) => {
    const bundle = fixture();
    change(bundle, "entry.1.resource.effectivePeriod", { start, end });
    if (accepted) assertFhirBundle(bundle);
    else rejects(bundle);
  });

  it.each([0, 1, 2, 3])("rejects relative patient references on entry %i", (index) => {
    const bundle = fixture();
    change(bundle, `entry.${index}.resource.subject`, { reference: "Patient/fictional-person" });
    rejects(bundle);
  });

  it.each([
    ["code.text", ""],
    ["code.text", 42],
    ["onsetDateTime", "invalid"],
    ["dosage", [{ text: "Wrong resource field" }]],
  ])("rejects malformed Condition.%s", (path, value) => {
    const bundle = fixture();
    change(bundle, `entry.0.resource.${path}`, value);
    rejects(bundle);
  });

  it("checks 100,001 entries before any proportional inspection", () => {
    const bundle = fixture();
    const entries = new Array(MAX_FHIR_RECORDS + 1);
    const getter = vi.fn(() => {
      throw new Error("Must not inspect entries");
    });
    Object.defineProperty(entries, 0, { get: getter, enumerable: true });
    bundle.entry = entries;
    rejects(bundle, "TOO_MANY_RECORDS");
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    "entry.0.resource.code.text",
    "entry.1.resource.medicationCodeableConcept.text",
    "entry.1.resource.dosage.0.text",
    "entry.2.resource.note.0.text",
  ])("independently enforces primitive text length at %s", (path) => {
    for (const character of ["a", "\u{1F4CA}"]) {
      const bundle = fixture();
      change(bundle, path, character.repeat(MAX_FHIR_STRING_LENGTH));
      assertFhirBundle(bundle);
      change(bundle, path, character.repeat(MAX_FHIR_STRING_LENGTH + 1));
      rejects(bundle);
    }
  });

  it("applies the string bound to Reference.reference", () => {
    const prefix = "https://example.org/";
    const suffix = "/Patient/person-1";
    const path = "a".repeat(MAX_FHIR_STRING_LENGTH - prefix.length - suffix.length);
    const bundle = fixture();
    change(bundle, "entry.0.resource.subject.reference", `${prefix}${path}${suffix}`);
    assertFhirBundle(bundle);
    change(bundle, "entry.0.resource.subject.reference", `${prefix}${path}a${suffix}`);
    rejects(bundle);
  });
});
