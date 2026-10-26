// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { emptyHealthDocument, parseHealth } from "../../src/apps/health/lib/model/io.js";
import {
  addMeasurement,
  aggregateMetric,
  Details,
  METRICS,
  type Measurement,
  type MetricKind,
  measurements,
  monthKey,
  monthKeys,
  validateMeasurement,
  validateRange,
  validDate,
} from "../../src/apps/health/lib/model/metrics.js";

const range = { start: new Date("2025-01-01Z"), end: new Date("2025-03-01Z") };
const sample = (
  value = 60,
  kind: MetricKind = "heartRate",
  iri = "https://pod.example/health/obs#1",
): Measurement => ({ iri, kind, value, at: new Date("2025-01-01T12:00Z"), source: "Watch" });
describe("metrics", () => {
  it("routes exact UTC month boundaries and excludes the end month", () => {
    expect(monthKey(new Date("2025-02-01T00:30+01:00"))).toBe("2025-01");
    expect(monthKeys(range)).toEqual(["2025-01", "2025-02"]);
    expect(
      monthKeys({
        start: new Date("2024-12-31T23:00Z"),
        end: new Date("2025-02-01T00:00:00.001Z"),
      }),
    ).toEqual(["2024-12", "2025-01", "2025-02"]);
    expect(() => validDate(new Date("bad"))).toThrow("Invalid date");
    expect(() => validateRange({ start: range.end, end: range.start })).toThrow("Range end");
    expect(() => monthKeys({ start: range.start, end: new Date("bad") })).toThrow("Invalid date");
  });
  it.each(
    Object.keys(METRICS) as MetricKind[],
  )("round-trips %s with canonical units and provenance", async (kind) => {
    const doc = emptyHealthDocument();
    const input = { ...sample(60, kind), note: "After breakfast" };
    addMeasurement(doc, input);
    expect(measurements(doc, kind, range)).toEqual([input]);
    const { toTurtle } = await import("../../src/apps/health/lib/model/serialise.js");
    expect(measurements(await parseHealth(await toTurtle(doc), input.iri), kind, range)).toEqual([
      input,
    ]);
    const details = new Details(input.iri, doc, DataFactory);
    details.name = "Reading";
    expect(details.name).toBe("Reading");
    details.note = undefined;
    details.name = undefined;
    details.source = undefined;
    expect(measurements(doc, kind, range)[0]).toMatchObject({ source: "Unknown" });
    expect(details.name).toBeUndefined();
  });
  it("validates finite values, kinds, source, identifiers and integral step counts", () => {
    for (const input of [
      sample(-1),
      sample(Number.NaN),
      sample(Number.POSITIVE_INFINITY),
      { ...sample(), kind: "unknown" as MetricKind },
      { ...sample(), source: " " },
      sample(1.5, "steps"),
      sample(1, "steps", "javascript:bad"),
    ]) {
      expect(() => validateMeasurement(input)).toThrow(TypeError);
    }
    expect(() => validateMeasurement(sample(0, "steps"))).not.toThrow();
  });
  it("skips incomplete / unrelated / out-of-range entries and requires normalized units", () => {
    const doc = emptyHealthDocument();
    addMeasurement(doc, sample());
    addMeasurement(doc, sample(10, "weight", "https://pod.example/weight"));
    const obs = doc.mintObservation("https://pod.example/missing", "HeartRate");
    expect(measurements(doc, "heartRate", range)).toHaveLength(1);
    obs.effectiveTime = "https://pod.example/time";
    doc.mintInstant(obs.effectiveTime).dateTime = range.start;
    expect(measurements(doc, "heartRate", range)).toHaveLength(1);
    obs.measuredValue = Number.NaN;
    expect(measurements(doc, "heartRate", range)).toHaveLength(1);
    obs.measuredValue = 80;
    doc.instant(obs.effectiveTime).dateTime = new Date("2024-12-31Z");
    expect(measurements(doc, "heartRate", range)).toHaveLength(1);
    doc.instant(obs.effectiveTime).dateTime = range.end;
    expect(measurements(doc, "heartRate", range)).toHaveLength(1);
    doc.instant(obs.effectiveTime).dateTime = range.start;
    expect(() => measurements(doc, "heartRate", range)).toThrow("unit");
    obs.unit = doc.observation(sample().iri).unit;
    expect(() => measurements(doc, "heartRate", range)).toThrow("unit");
    obs.unitCode = "/min";
    expect(measurements(doc, "heartRate", range).map((item) => item.value)).toEqual([80, 60]);
    addMeasurement(doc, sample(70, "heartRate", "https://pod.example/health/obs#0"));
    expect(measurements(doc, "heartRate", range).map((item) => item.value)).toEqual([80, 70, 60]);
  });
  it.each([
    "dateTimeStamp",
    "dateTime",
    "date",
  ])("skips invalid xsd:%s timestamps before aggregation", async (datatype) => {
    const doc = await parseHealth(
      `
      <#invalidObservation> a <${NS.HEALTH}HeartRateObservation>;
        <${NS.HEALTH}effectiveTime> <#time>; <${NS.HEALTH}value> 80;
        <${NS.HEALTH}hasUnit> <${NS.UNIT}BEAT-PER-MIN>; <${NS.HEALTH}unitCode> "/min".
      <#time> <http://www.w3.org/2006/time#inXSDDateTimeStamp> "invalid"^^<${NS.XSD}${datatype}>.
    `,
      "https://pod.example/health/obs",
    );
    addMeasurement(doc, sample());
    const entries = measurements(doc, "heartRate", range);
    expect(entries).toEqual([sample()]);
    expect(aggregateMetric(entries, "daily")).toEqual([{ key: "2025-01-01", value: 60, count: 1 }]);
  });
  it("aggregates UTC days and ISO Monday weeks across year/month boundaries", () => {
    const entries = [
      sample(10, "steps"),
      { ...sample(20, "steps"), at: new Date("2025-01-05T23:59Z") },
      { ...sample(40, "steps"), at: new Date("2025-01-06Z") },
      sample(5, "steps"),
    ];
    expect(aggregateMetric(entries, "daily")).toEqual([
      { key: "2025-01-01", value: 15, count: 2 },
      { key: "2025-01-05", value: 20, count: 1 },
      { key: "2025-01-06", value: 40, count: 1 },
    ]);
    expect(aggregateMetric(entries, "weekly")).toEqual([
      { key: "2024-12-30", value: 35, count: 3 },
      { key: "2025-01-06", value: 40, count: 1 },
    ]);
    expect(aggregateMetric([sample(60), sample(80)], "daily")[0]?.value).toBe(70);
    expect(aggregateMetric([sample(10, "sleep"), sample(20, "sleep")], "daily")[0]?.value).toBe(30);
    expect(aggregateMetric([], "weekly")).toEqual([]);
    expect(() => aggregateMetric([sample(), sample(20, "steps")], "daily")).toThrow(
      "different metrics",
    );
    expect(entries[0]?.at.toISOString()).toBe("2025-01-01T12:00:00.000Z");
  });
});
it("rejects inherited metric keys and mixing metrics across different buckets", () => {
  expect(() => validateMeasurement({ ...sample(), kind: "constructor" as MetricKind })).toThrow(
    "Invalid measurement",
  );
  expect(() =>
    aggregateMetric([sample(), { ...sample(10, "steps"), at: new Date("2025-02-01Z") }], "daily"),
  ).toThrow("different metrics");
});
it("reads direct LOINC concepts and requires the LOINC scheme on local code nodes", () => {
  const doc = emptyHealthDocument();
  const input = sample(70, "weight");
  addMeasurement(doc, input);
  const observation = doc.observation(input.iri);
  const code = doc.codeableConcept(observation.code as string);
  expect(code.code).toBe("29463-7");
  code.scheme = "https://other.example/scheme";
  expect(measurements(doc, "weight", range)).toEqual([]);
  observation.code = "http://loinc.org/rdf/29463-7";
  expect(measurements(doc, "weight", range)).toEqual([input]);
});
