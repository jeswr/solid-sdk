// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { MealData, ProtocolData, SymptomData, ToleranceConclusionData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { proposeNext } from "./propose";
import { atDays, meal, symptom } from "./testUtils";
import type { DiaryData } from "./types";

/** A strong, unconfounded suspicion for a tight-window trigger (reaches 'suspected'). */
function strongSuspect(trigger: "sulphites" | "lactose", offsetHours = 0): { meals: MealData[]; symptoms: SymptomData[] } {
  const base = [0, 48, 96, 144].map((h) => h + offsetHours);
  const meals = base.map((h) =>
    meal({ id: `https://pod.example/meals/${trigger}-${h}`, hours: h, exposures: [{ trigger }] }),
  );
  // 3 of 4 followed by a symptom 1 h later (inside the tight window).
  const symptoms = base.slice(0, 3).map((h) => symptom({ id: `https://pod.example/symptoms/${trigger}-${h}`, hours: h + 1 }));
  return { meals, symptoms };
}

function glutenSuspect(): { meals: MealData[]; symptoms: SymptomData[] } {
  const base = [0, 96, 192, 288];
  const meals = base.map((h) => meal({ id: `https://pod.example/meals/g-${h}`, hours: h, exposures: [{ trigger: "gluten" }] }));
  const symptoms = base.slice(0, 3).map((h) => symptom({ id: `https://pod.example/symptoms/g-${h}`, hours: h + 3 }));
  return { meals, symptoms };
}

describe("proposeNext — pre-diagnosis gluten HARD BLOCK (RESEARCH §4)", () => {
  it("never proposes gluten elimination when coeliac is undiagnosed → 'none' + get-tested message", () => {
    const g = glutenSuspect();
    const proposal = proposeNext({ meals: g.meals, symptoms: g.symptoms }, { coeliacDiagnosed: false });
    expect(proposal.kind).toBe("none");
    expect(proposal.trigger).toBe("gluten");
    expect(proposal.rationale.toLowerCase()).toContain("tested");
  });

  it("proposes a NON-gluten alternative instead of a blocked gluten suspect", () => {
    const g = glutenSuspect();
    const s = strongSuspect("sulphites", 1000);
    const diary: DiaryData = { meals: [...g.meals, ...s.meals], symptoms: [...g.symptoms, ...s.symptoms] };
    const proposal = proposeNext(diary, { coeliacDiagnosed: false });
    expect(proposal.kind).toBe("eliminate");
    expect(proposal.trigger).toBe("sulphites");
    expect(proposal.trigger).not.toBe("gluten");
  });

  it("DOES propose gluten once coeliac is confirmed", () => {
    const g = glutenSuspect();
    const proposal = proposeNext({ meals: g.meals, symptoms: g.symptoms }, { coeliacDiagnosed: true });
    expect(proposal.kind).toBe("eliminate");
    expect(proposal.trigger).toBe("gluten");
    expect(proposal.basedOn?.confidence).not.toBe("confirmed");
    expect(proposal.suggestedSchedule).toBeDefined();
  });
});

describe("proposeNext — one-variable-at-a-time (DESIGN §3/§4.3)", () => {
  const s = strongSuspect("sulphites");

  it("suppresses new proposals while a challenge is active (reintroduce/observe)", () => {
    const active: ProtocolData = {
      id: "https://pod.example/protocols/lactose#it",
      targetTrigger: "lactose",
      phase: "reintroduce",
    };
    const proposal = proposeNext(
      { meals: s.meals, symptoms: s.symptoms, protocols: [active] },
      { coeliacDiagnosed: true },
    );
    expect(proposal.kind).toBe("wait-active-challenge");
    expect(proposal.trigger).toBe("lactose");
    expect(proposal.relatedResource).toBe(active.id);
  });

  it("suppresses while ANY protocol is in progress, including BASELINE (one variable at a time)", () => {
    for (const phase of ["baseline", "eliminate", "washout"] as const) {
      const inProgress: ProtocolData = {
        id: "https://pod.example/protocols/lactose#it",
        targetTrigger: "lactose",
        phase,
      };
      const proposal = proposeNext(
        { meals: s.meals, symptoms: s.symptoms, protocols: [inProgress] },
        { coeliacDiagnosed: true },
      );
      expect(proposal.kind).toBe("wait-active-challenge");
    }
  });

  it("does NOT suppress once the protocol is concluded", () => {
    const done: ProtocolData = {
      id: "https://pod.example/protocols/lactose#it",
      targetTrigger: "lactose",
      phase: "concluded",
    };
    const proposal = proposeNext(
      { meals: s.meals, symptoms: s.symptoms, protocols: [done] },
      { coeliacDiagnosed: true },
    );
    expect(proposal.kind).toBe("eliminate");
    expect(proposal.trigger).toBe("sulphites");
  });
});

describe("proposeNext — expansion bias (orthorexia guard, RESEARCH §2.8)", () => {
  it("offers a DUE re-challenge before proposing a new elimination", () => {
    const s = strongSuspect("sulphites");
    const dueReview: ToleranceConclusionData = {
      id: "https://pod.example/conclusions/lactose#it",
      aboutTrigger: "lactose",
      verdict: "reacts",
      confidence: "confirmed",
      reviewAfter: atDays(182),
    };
    const proposal = proposeNext(
      { meals: s.meals, symptoms: s.symptoms, conclusions: [dueReview] },
      { coeliacDiagnosed: true },
      { now: atDays(300) },
    );
    expect(proposal.kind).toBe("re-challenge");
    expect(proposal.trigger).toBe("lactose");
    expect(proposal.relatedResource).toBe(dueReview.id);
  });
});

describe("proposeNext — never fabricates from thin data", () => {
  it("empty diary → 'none'", () => {
    expect(proposeNext({ meals: [], symptoms: [] }, { coeliacDiagnosed: true }).kind).toBe("none");
  });

  it("a single event → 'none' (only emerging)", () => {
    const proposal = proposeNext(
      { meals: [meal({ hours: 0, exposures: [{ trigger: "sulphites" }] })], symptoms: [symptom({ hours: 1 })] },
      { coeliacDiagnosed: true },
    );
    expect(proposal.kind).toBe("none");
  });

  it("skips a trigger that is already SETTLED by a confirmed protocol", () => {
    const s = strongSuspect("sulphites");
    const confirmed: ToleranceConclusionData = {
      id: "https://pod.example/conclusions/sulphites#it",
      aboutTrigger: "sulphites",
      verdict: "reacts",
      confidence: "confirmed",
    };
    const proposal = proposeNext(
      { meals: s.meals, symptoms: s.symptoms, conclusions: [confirmed] },
      { coeliacDiagnosed: true },
    );
    expect(proposal.kind).toBe("none");
  });

  it("still proposes re-testing after a confirmed but INCONCLUSIVE protocol", () => {
    const s = strongSuspect("sulphites");
    const inconclusive: ToleranceConclusionData = {
      id: "https://pod.example/conclusions/sulphites#it",
      aboutTrigger: "sulphites",
      verdict: "inconclusive",
      confidence: "confirmed",
    };
    const proposal = proposeNext(
      { meals: s.meals, symptoms: s.symptoms, conclusions: [inconclusive] },
      { coeliacDiagnosed: true },
    );
    expect(proposal.kind).toBe("eliminate");
    expect(proposal.trigger).toBe("sulphites");
  });
});
