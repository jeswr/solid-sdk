// AUTHORED-BY Claude Sonnet 5.5
import { expect, it } from "vitest";
import {
  correctionBlocker,
  isUncertain,
  knowledgeStats,
  needsReview,
  preserveTemporal,
  sourceCounts,
} from "../src/apps/health/lib/knowledge/view-model";
import { condition, viewOf } from "./knowledge-fact-fixtures";

it("K1: ranks review items by evidence time without spreading a huge evidence list", () => {
  const evidence = Array.from({ length: 300_000 }, (_, i) => ({
    source: "https://example.org/fictional/source",
    timestamp: `2025-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
  }));
  const fact = condition(1, { belief: "might" });
  fact.provenance = { ...fact.provenance, evidence };
  expect(() => needsReview(viewOf([fact]))).not.toThrow();
  expect(needsReview(viewOf([fact]))).toHaveLength(1);
});

it("K1: counts sources in one pass", () => {
  const source = { iri: "https://example.org/fictional/s", batch: "b" };
  const fact = condition(1);
  fact.provenance = { ...fact.provenance, sources: [source as never, source as never] };
  const view = { ...viewOf([fact, condition(2)]), sources: [source as never] };
  expect(sourceCounts(view)[0]?.count).toBe(1);
});

it("K2: facts with an unread later update or missing provenance are not counted as current", () => {
  const view = viewOf([
    condition(1),
    condition(2, { affectedBySkipped: true }),
    condition(3, { provenanceUnavailable: true }),
  ]);
  expect(knowledgeStats(view).conditions).toBe(1);
  expect(isUncertain(view.facts[1] as never)).toBe(true);
  expect(needsReview(view).map((f) => f.label)).toEqual(
    expect.arrayContaining(["Fictional condition 2", "Fictional condition 3"]),
  );
  expect(needsReview(view)).toHaveLength(2);
});

it("K3: recorded dateTime literals are preserved and zoned dates are reported as unsupported", () => {
  expect(preserveTemporal("2025-03-03T10:00:00Z")).toEqual({
    value: "2025-03-03T10:00:00Z",
    datatype: "dateTime",
  });
  expect(preserveTemporal("2025-03")).toEqual({ value: "2025-03", datatype: "gYearMonth" });
  expect(preserveTemporal("2025-03-03+01:00")).toBe("unsupported");
  expect(preserveTemporal(undefined)).toBeUndefined();
});

it("K3: correction is disabled when the fact holds data the form cannot keep", () => {
  expect(correctionBlocker(condition(1, { period: { start: "2025-03-03T10:00:00Z" } }))).toBe("");
  expect(correctionBlocker(condition(1, { period: { start: "2025-03-03+01:00" } }))).not.toBe("");
  const medication = (dose: unknown, doseSchedule?: string) =>
    condition(1, {
      kind: "medication",
      product: { name: "Fictional medicine" },
      dose,
      doseSchedule,
    } as never);
  expect(correctionBlocker(medication({ value: "1.5", unit: "tablet" }))).toBe("");
  expect(correctionBlocker(medication({ value: "1-2", unit: "tablet" }))).not.toBe("");
  expect(correctionBlocker(medication(undefined, "twice daily"))).not.toBe("");
  const allergy = (substance: string) =>
    condition(1, { kind: "allergy", label: "Fictional allergy", substance } as never);
  expect(correctionBlocker(allergy("Fictional allergy"))).toBe("");
  expect(correctionBlocker(allergy("Fictional birch pollen"))).not.toBe("");
});
