// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { EMERGENCY_SYMPTOM_TYPES } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import {
  evaluateSafetyRails,
  isEmergencySymptom,
  partitionEmergencySymptoms,
  preDiagnosisGlutenBlock,
} from "./safety";
import { symptom } from "./testUtils";
import type { DietPlanData } from "@jeswr/solid-health-diary";

describe("emergency partition + exclusion", () => {
  it("classifies the model's emergency types as emergencies", () => {
    for (const t of EMERGENCY_SYMPTOM_TYPES) {
      expect(isEmergencySymptom({ symptomType: t })).toBe(true);
    }
    expect(isEmergencySymptom({ symptomType: "bloating" })).toBe(false);
  });

  it("splits emergency symptoms out of the correlation set", () => {
    const symptoms = [
      symptom({ hours: 1, type: "anaphylaxis" }),
      symptom({ hours: 2, type: "bloating" }),
      symptom({ hours: 3, type: "wheeze-breathing" }),
    ];
    const { emergency, qualifying } = partitionEmergencySymptoms(symptoms);
    expect(emergency.map((s) => s.symptomType).sort()).toEqual(["anaphylaxis", "wheeze-breathing"]);
    expect(qualifying.map((s) => s.symptomType)).toEqual(["bloating"]);
  });
});

describe("evaluateSafetyRails — each rail fires on its own trigger (DESIGN §4.4)", () => {
  it("EMERGENCY rail on a breathing/anaphylaxis symptom", () => {
    const rails = evaluateSafetyRails({ symptoms: [symptom({ hours: 1, type: "wheeze-breathing" })] });
    const rail = rails.find((r) => r.kind === "emergency-anaphylaxis");
    expect(rail?.severity).toBe("emergency");
  });

  it("ALARM rail on a caller-supplied alarm flag (weight loss / GI bleed / …)", () => {
    const rails = evaluateSafetyRails({
      symptoms: [],
      context: { alarmFlags: { giBleeding: true } },
    });
    const rail = rails.find((r) => r.kind === "alarm-symptoms");
    expect(rail?.severity).toBe("urgent");
    expect(rail?.message.toLowerCase()).toContain("bleeding");
  });

  it("PERSISTENCE rail on symptoms despite reported strict adherence", () => {
    const rails = evaluateSafetyRails({
      symptoms: [symptom({ hours: 1, type: "diarrhoea" })],
      context: { strictAdherence: true },
    });
    expect(rails.some((r) => r.kind === "persistent-despite-adherence")).toBe(true);
  });

  it("RESTRICTION-ANXIETY rail when the exclusion set is large", () => {
    const plan: DietPlanData = {
      id: "https://pod.example/health/diary/plan#it",
      excludes: ["gluten", "lactose", "fructose", "fructan", "galactan", "polyol"],
    };
    const rails = evaluateSafetyRails({ symptoms: [], plan });
    const rail = rails.find((r) => r.kind === "restriction-anxiety");
    expect(rail?.severity).toBe("advisory");
    expect(rail?.evidence).toContain(plan.id);
  });

  it("does NOT fire the restriction-anxiety rail below the threshold", () => {
    const plan: DietPlanData = { id: "https://pod.example/plan#it", excludes: ["gluten", "lactose"] };
    const rails = evaluateSafetyRails({ symptoms: [], plan });
    expect(rails.some((r) => r.kind === "restriction-anxiety")).toBe(false);
  });

  it("orders rails strongest-first (emergency before advisory)", () => {
    const plan: DietPlanData = {
      id: "https://pod.example/plan#it",
      excludes: ["gluten", "lactose", "fructose", "fructan", "galactan", "polyol"],
    };
    const rails = evaluateSafetyRails({
      symptoms: [symptom({ hours: 1, type: "anaphylaxis" })],
      plan,
    });
    expect(rails[0]!.kind).toBe("emergency-anaphylaxis");
  });
});

describe("pre-diagnosis gluten hard block (RESEARCH §4)", () => {
  it("fires when coeliac is NOT confirmed", () => {
    const rail = preDiagnosisGlutenBlock({ coeliacDiagnosed: false });
    expect(rail?.kind).toBe("pre-diagnosis-gluten");
    expect(rail?.severity).toBe("urgent");
    expect(rail?.message.toLowerCase()).toContain("get tested");
  });

  it("fires when the diagnosis flag is absent (fail-closed)", () => {
    expect(preDiagnosisGlutenBlock(undefined)?.kind).toBe("pre-diagnosis-gluten");
    expect(preDiagnosisGlutenBlock({})?.kind).toBe("pre-diagnosis-gluten");
  });

  it("does NOT fire once coeliac is confirmed", () => {
    expect(preDiagnosisGlutenBlock({ coeliacDiagnosed: true })).toBeUndefined();
  });
});
