// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, it } from "vitest";
import { correlate } from "./correlate.js";
import { diaryTriggers } from "./diary-triggers.js";
import { at, meal, symptom } from "./testUtils.js";

describe("correlate observedUntil", () => {
  it("does not count an exposure inside its lag window with no symptom as not followed", () => {
    const meals = [
      meal({ hours: 0, exposures: [{ trigger: "gluten" }] }),
      meal({ hours: 100, exposures: [{ trigger: "gluten" }] }),
    ];
    const symptoms = [symptom({ hours: 10 })];
    // The second meal's 72 h window is still open.
    const open = correlate(meals, symptoms, { observedUntil: at(110) }).find(
      (score) => score.trigger === "gluten",
    );
    expect(open).toMatchObject({ exposureCount: 1, followedCount: 1 });
    // Unchanged without the option.
    expect(correlate(meals, symptoms)[0]).toMatchObject({ exposureCount: 2 });
  });
  it("keeps a still-open exposure that a symptom has already followed", () => {
    const meals = [meal({ hours: 100, exposures: [{ trigger: "gluten" }] })];
    const scores = correlate(meals, [symptom({ hours: 105 })], { observedUntil: at(110) });
    expect(scores[0]).toMatchObject({ exposureCount: 1, followedCount: 1 });
  });
});

describe("diaryTriggers", () => {
  const gluten = [meal({ hours: 0, exposures: [{ trigger: "gluten" }] })];
  it("raises the pre-diagnosis gluten warning before a coeliac diagnosis, and not after", () => {
    const warned = diaryTriggers({ meals: gluten, symptoms: [symptom({ hours: 5 })] }, {}, at(200));
    expect(warned.safetyRails.map((rail) => rail.kind)).toContain("pre-diagnosis-gluten");
    expect(warned.suspicions[0]?.trigger).toBe("gluten");
    const diagnosed = diaryTriggers(
      { meals: gluten, symptoms: [symptom({ hours: 5 })] },
      { coeliacDiagnosed: true },
      at(200),
    );
    expect(diagnosed.safetyRails).toEqual([]);
  });
  it("warns even when the gluten exposure is too recent to have a suspicion", () => {
    const result = diaryTriggers({ meals: gluten, symptoms: [] }, {}, at(1));
    expect(result.suspicions).toEqual([]);
    expect(result.safetyRails.map((rail) => rail.kind)).toEqual(["pre-diagnosis-gluten"]);
  });
  it("raises nothing for a diary with no gluten and no alarm", () => {
    const lactose = [meal({ hours: 0, exposures: [{ trigger: "lactose" }] })];
    expect(diaryTriggers({ meals: lactose, symptoms: [] }, {}, at(200)).safetyRails).toEqual([]);
  });
  it("puts the emergency rail first, above alarm and gluten rails", () => {
    const result = diaryTriggers(
      { meals: gluten, symptoms: [symptom({ hours: 5, type: "anaphylaxis" })] },
      { alarmFlags: { giBleeding: true } },
      at(200),
    );
    const kinds = result.safetyRails.map((rail) => rail.kind);
    expect(kinds[0]).toBe("emergency-anaphylaxis");
    expect(kinds).toEqual(expect.arrayContaining(["alarm-symptoms", "pre-diagnosis-gluten"]));
    expect(result.suspicions.every((score) => score.attributedSymptomCount === 0)).toBe(true);
  });
  it("ignores entries after now", () => {
    const result = diaryTriggers({ meals: gluten, symptoms: [] }, {}, at(-1));
    expect(result.safetyRails).toEqual([]);
  });
});
