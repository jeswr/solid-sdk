// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.

import { describe, expect, it } from "vitest";
import {
  buildDietPlan,
  buildToleranceConclusion,
  conclusionSubject,
  type DietPlanData,
  dietPlanSubject,
  parseDietPlan,
  parseDietPlanTtl,
  parseToleranceConclusion,
  parseToleranceConclusionTtl,
  serializeDietPlan,
  serializeToleranceConclusion,
  type ToleranceConclusionData,
} from "./conclusion.js";

const BASE = "https://alice.pod.example/health/diary";
const CONC_URL = `${BASE}/conclusions/lactose.ttl`;
const PLAN_URL = `${BASE}/plan.ttl`;
const ME = `${BASE.replace("/health/diary", "")}/profile/card#me`;

describe("ToleranceConclusion round-trip (parse∘build == identity)", () => {
  it("a fully-populated conclusion round-trips (incl. reviewAfter date + provenance)", async () => {
    const data: ToleranceConclusionData = {
      id: conclusionSubject(CONC_URL),
      aboutTrigger: "lactose",
      verdict: "reacts",
      confidence: "likely",
      note: "This is a pattern in your data, not a diagnosis.",
      reviewAfter: new Date("2027-01-01"),
      derivedFrom: [`${BASE}/meals/2026/07/01.ttl#exposure-0`],
      patient: ME,
      created: new Date("2026-07-01T00:00:00.000Z"),
    };
    const parsed = await parseToleranceConclusionTtl(
      CONC_URL,
      await serializeToleranceConclusion(CONC_URL, data),
    );
    expect(parsed).toEqual(data);
  });

  it("reviewAfter serialises as a valid DATE-ONLY xsd:date lexical (YYYY-MM-DD, not a timestamp)", async () => {
    const ttl = await serializeToleranceConclusion(CONC_URL, {
      aboutTrigger: "lactose",
      verdict: "reacts",
      reviewAfter: new Date("2027-01-02"),
      created: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(ttl).toMatch(/"2027-01-02"\^\^<[^>]*XMLSchema#date>|"2027-01-02"\^\^xsd:date/);
    expect(ttl).not.toMatch(/reviewAfter\s+"2027-01-02T/); // never a full timestamp under xsd:date
  });

  it("a minimal conclusion (trigger + verdict) round-trips", () => {
    const data: ToleranceConclusionData = {
      id: conclusionSubject(CONC_URL),
      aboutTrigger: "gluten",
      verdict: "inconclusive",
      created: new Date("2026-07-01T00:00:00.000Z"),
    };
    expect(parseToleranceConclusion(CONC_URL, buildToleranceConclusion(CONC_URL, data))).toEqual(
      data,
    );
  });
});

describe("DietPlan round-trip (parse∘build == identity)", () => {
  it("a plan with excluded triggers + the conclusions they rest on round-trips", async () => {
    const data: DietPlanData = {
      id: dietPlanSubject(PLAN_URL),
      excludes: ["gluten", "lactose"],
      restsOn: [`${BASE}/conclusions/gluten.ttl#it`, `${BASE}/conclusions/lactose.ttl#it`],
      patient: ME,
      created: new Date("2026-07-01T00:00:00.000Z"),
    };
    const parsed = await parseDietPlanTtl(PLAN_URL, await serializeDietPlan(PLAN_URL, data));
    expect(parsed).toEqual(data);
  });

  it("a plan that excludes a trigger with no recorded basis round-trips", () => {
    const data: DietPlanData = {
      id: dietPlanSubject(PLAN_URL),
      excludes: ["sulphites"],
      created: new Date("2026-07-01T00:00:00.000Z"),
    };
    expect(parseDietPlan(PLAN_URL, buildDietPlan(PLAN_URL, data))).toEqual(data);
  });

  it("an empty plan round-trips", () => {
    const data: DietPlanData = {
      id: dietPlanSubject(PLAN_URL),
      excludes: [],
      created: new Date("2026-07-01T00:00:00.000Z"),
    };
    expect(parseDietPlan(PLAN_URL, buildDietPlan(PLAN_URL, data))).toEqual(data);
  });
});

describe("buildToleranceConclusion fail-closed on required coded values (SHACL MUSTs)", () => {
  it("throws on a missing or non-canonical aboutTrigger", () => {
    expect(() =>
      buildToleranceConclusion(CONC_URL, {
        verdict: "reacts",
      } as unknown as ToleranceConclusionData),
    ).toThrow(/aboutTrigger/);
    expect(() =>
      buildToleranceConclusion(CONC_URL, {
        aboutTrigger: "not-a-trigger",
        verdict: "reacts",
      } as unknown as ToleranceConclusionData),
    ).toThrow(/aboutTrigger/);
  });

  it("throws on a missing or non-canonical verdict", () => {
    expect(() =>
      buildToleranceConclusion(CONC_URL, {
        aboutTrigger: "lactose",
      } as unknown as ToleranceConclusionData),
    ).toThrow(/verdict/);
    expect(() =>
      buildToleranceConclusion(CONC_URL, {
        aboutTrigger: "lactose",
        verdict: "bogus",
      } as unknown as ToleranceConclusionData),
    ).toThrow(/verdict/);
  });

  it("throws on an INVALID reviewAfter Date (never persists a NaN-NaN-NaN xsd:date)", () => {
    expect(() =>
      buildToleranceConclusion(CONC_URL, {
        aboutTrigger: "lactose",
        verdict: "reacts",
        reviewAfter: new Date("nope"),
      }),
    ).toThrow(/reviewAfter/);
  });
});

describe("buildDietPlan fail-closed on non-canonical excludes", () => {
  it("throws when an excludes entry is not a known TriggerClass", () => {
    expect(() =>
      buildDietPlan(PLAN_URL, {
        excludes: ["not-a-trigger"],
      } as unknown as DietPlanData),
    ).toThrow(/excludes/);
  });

  it("parseDietPlan REJECTS a corrupt restriction list (an unknown excludes IRI) — never under-restricts", async () => {
    // A DietPlan is a SAFETY document. A hostile/corrupt excludes IRI must NOT be
    // silently dropped to yield a plan with fewer restrictions — reject the whole plan.
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${PLAN_URL}#it> a diet:DietPlan ;
        diet:excludes diet:gluten , diet:notARealTrigger .`;
    expect(await parseDietPlanTtl(PLAN_URL, ttl)).toBeUndefined();
  });
});
