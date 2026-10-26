// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { importAppleHealth, parseAppleDate } from "../../src/apps/health/lib/model/apple-health.js";

async function* chunks(xml: string, size = 17) {
  for (let i = 0; i < xml.length; i += size) yield xml.slice(i, i + size);
}
const iri = (index: number) => `https://pod.example/health/import#${index}`;
const collect = async (xml: string) => Array.fromAsync(importAppleHealth(chunks(xml), iri));
it("streams the Apple fixture to seven canonical observations with decoded provenance", async () => {
  const xml = await readFile(new URL("./fixtures/apple-health.xml", import.meta.url), "utf8");
  const result = await collect(xml);
  expect(result).toHaveLength(7);
  expect(result.map((item) => item.kind)).toEqual([
    "heartRate",
    "steps",
    "weight",
    "weight",
    "sleep",
    "systolic",
    "diastolic",
  ]);
  expect(result.map((item) => item.value)).toEqual([72, 1250, 70, 45.359237, 3600, 120, 80]);
  expect(result[0]?.source).toBe("Watch & Phone");
  expect(result[1]?.source).toBe("Apple Health");
  expect(result[0]?.at.toISOString()).toBe("2025-01-01T08:00:00.000Z");
  expect(result[6]?.iri).toBe(iri(6));
});
it("supports ISO dates, grams and unspecified sleep, skipping unsupported kinds and awake states", async () => {
  expect(parseAppleDate("2025-01-01T08:00Z").toISOString()).toContain("08:00");
  const result = await collect(`<HealthData>
    <Record type="HKQuantityTypeIdentifierBodyMass" startDate="2025-01-01T08:00Z" value="70000" unit="g" />
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2025-01-01T08:00Z" endDate="2025-01-01T09:00Z" value="HKCategoryValueSleepAnalysisAsleep" />
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2025-01-01T08:00Z" value="HKCategoryValueSleepAnalysisInBed" />
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2025-01-01T08:00Z"/><Record/><Record type="constructor"/><Record type="FutureKind"/><Workout/>
  </HealthData>`);
  expect(result.map((item) => item.value)).toEqual([70, 3600]);
});
it("does not consume later chunks until the caller advances the iterator", async () => {
  let next = false;
  async function* source() {
    yield '<HealthData><Record type="HKQuantityTypeIdentifierStepCount" startDate="2025-01-01Z" value="1" unit="count"/>';
    next = true;
    yield "</HealthData>";
  }
  const iterator = importAppleHealth(source(), iri);
  expect((await iterator.next()).value).toMatchObject({ value: 1 });
  expect(next).toBe(false);
  expect((await iterator.next()).done).toBe(true);
  expect(next).toBe(true);
});
it.each([
  "<wrong/>",
  "<HealthData>",
  "",
  "<HealthData>&external;</HealthData>",
  '<HealthData><Record type="HKQuantityTypeIdentifierStepCount" /></HealthData>',
  '<HealthData><Record type="HKQuantityTypeIdentifierStepCount" startDate="2025-01-01Z" unit="count" /></HealthData>',
  '<HealthData><Record type="HKQuantityTypeIdentifierStepCount" startDate="2025-01-01Z" value="" unit="count" /></HealthData>',
  '<HealthData><Record type="HKQuantityTypeIdentifierStepCount" startDate="2025-01-01Z" value="1" unit="furlongs" /></HealthData>',
  '<HealthData><Record type="HKQuantityTypeIdentifierStepCount" startDate="2025-01-01Z" value="NaN" unit="count" /></HealthData>',
  '<HealthData><Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2025-01-01Z" value="HKCategoryValueSleepAnalysisAsleepREM" /></HealthData>',
  '<HealthData><Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2025-01-02Z" endDate="2025-01-01Z" value="HKCategoryValueSleepAnalysisAsleepDeep" /></HealthData>',
])("rejects malformed supported records/XML: %s", async (xml) => {
  await expect(collect(xml)).rejects.toThrow();
});
