// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { ProtocolData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { atDays, meal, symptom } from "./testUtils";
import { SUSPICION_CONFIDENCE_ORDER, type DiaryData } from "./types";

function richDiary(): DiaryData {
  const meals = [0, 48, 96, 144].map((h) =>
    meal({ id: `https://pod.example/meals/su-${h}`, hours: h, exposures: [{ trigger: "sulphites" }] }),
  );
  const symptoms = [0, 48, 96].map((h) => symptom({ id: `https://pod.example/symptoms/su-${h}`, hours: h + 1 }));
  return { meals, symptoms };
}

/** A diary with gluten exposures (so the pre-diagnosis gluten rail is relevant). */
function glutenDiary(): DiaryData {
  const meals = [0, 96, 192].map((h) =>
    meal({ id: `https://pod.example/meals/g-${h}`, hours: h, exposures: [{ trigger: "gluten" }] }),
  );
  const symptoms = [0, 96].map((h) => symptom({ id: `https://pod.example/symptoms/g-${h}`, hours: h + 3 }));
  return { meals, symptoms };
}

describe("analyze — integration", () => {
  it("returns rails, ranked suspicions, a proposal, and reviews", () => {
    const result = analyze(richDiary(), { coeliacDiagnosed: true });
    expect(Array.isArray(result.safetyRails)).toBe(true);
    expect(result.suspicions.length).toBeGreaterThan(0);
    expect(result.proposal.kind).toBe("eliminate");
    expect(result.proposal.trigger).toBe("sulphites");
    expect(result.reviews).toEqual([]);
  });

  it("puts the EMERGENCY rail first when an anaphylaxis symptom is present", () => {
    const diary = richDiary();
    const withEmergency: DiaryData = {
      ...diary,
      symptoms: [...diary.symptoms, symptom({ hours: 200, type: "anaphylaxis" })],
    };
    const result = analyze(withEmergency, { coeliacDiagnosed: true });
    expect(result.safetyRails[0]!.kind).toBe("emergency-anaphylaxis");
  });

  it("surfaces the pre-diagnosis gluten rail for an undiagnosed user WITH gluten in play", () => {
    const result = analyze(glutenDiary(), { coeliacDiagnosed: false });
    expect(result.safetyRails.some((r) => r.kind === "pre-diagnosis-gluten")).toBe(true);
  });

  it("does NOT surface the gluten rail on an undiagnosed diary with NO gluten in play", () => {
    const result = analyze(richDiary(), { coeliacDiagnosed: false });
    expect(result.safetyRails.some((r) => r.kind === "pre-diagnosis-gluten")).toBe(false);
  });

  it("orders the urgent pre-diagnosis-gluten rail ABOVE an advisory restriction rail", () => {
    const diary: DiaryData = {
      ...glutenDiary(),
      plan: {
        id: "https://pod.example/plan#it",
        excludes: ["lactose", "fructose", "fructan", "galactan", "polyol", "sulphites"],
      },
    };
    const rails = analyze(diary, { coeliacDiagnosed: false }).safetyRails;
    const gluten = rails.findIndex((r) => r.kind === "pre-diagnosis-gluten");
    const anxiety = rails.findIndex((r) => r.kind === "restriction-anxiety");
    expect(gluten).toBeGreaterThanOrEqual(0);
    expect(anxiety).toBeGreaterThanOrEqual(0);
    expect(gluten).toBeLessThan(anxiety);
  });

  it("attaches a reintroduction schedule for the one active challenge", () => {
    const active: ProtocolData = {
      id: "https://pod.example/protocols/lactose#it",
      targetTrigger: "lactose",
      phase: "reintroduce",
    };
    const diary: DiaryData = { ...richDiary(), protocols: [active] };
    const result = analyze(diary, { coeliacDiagnosed: true }, { now: atDays(0) });
    expect(result.reintroductionSchedule?.trigger).toBe("lactose");
    expect(result.reintroductionSchedule?.steps.length).toBe(3);
    // ...and the proposal is suppressed (one at a time).
    expect(result.proposal.kind).toBe("wait-active-challenge");
  });
});

describe("analyze — anti-overclaim (no diagnosis, ever)", () => {
  it("no suspicion is ever 'confirmed' and each carries a disclaimer", () => {
    const result = analyze(richDiary(), { coeliacDiagnosed: true });
    for (const s of result.suspicions) {
      expect(SUSPICION_CONFIDENCE_ORDER).toContain(s.confidence);
      expect(s.disclaimer.toLowerCase()).toContain("not a diagnosis");
    }
  });
});
