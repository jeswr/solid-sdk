// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Exhaustive tests for the elimination-protocol FSM (Brief 2B). Health data is
 * security-critical, so this suite proves EVERY transition, EVERY health-safety
 * rail, the one-active-challenge invariant, fail-closed handling of malformed
 * input, and the `confirmed`-conclusion gate (a completed protocol is the ONLY
 * path to a `confirmed` verdict, via `deriveConfirmedConclusion`).
 */
import {
  countActiveChallenges,
  isActiveChallengePhase,
  type ProtocolData,
  PROTOCOL_PHASES,
  type Verdict,
} from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { deriveConfirmedConclusion } from "../inference/conclude";
import {
  advanceProtocol,
  challengeSafetyRefusal,
  CLINICIAN_CAVEAT,
  DOSE_LADDER,
  isPhaseElapsed,
  nextAction,
  promptFor,
  type ProtocolSafetyContext,
  startProtocol,
} from "./fsm";

const NOW = new Date("2026-07-03T09:00:00.000Z");

/** Start a fresh (non-gluten, non-emergency) protocol and unwrap the ok result. */
function freshLactose(now = NOW): ProtocolData {
  const r = startProtocol({ trigger: "lactose" }, {}, now);
  if (!r.ok) throw new Error(`expected ok start, got refusal ${r.refusal.kind}`);
  return r.protocol;
}

/** Advance and unwrap, asserting the event was NOT rejected. */
function step(
  protocol: ProtocolData,
  event: Parameters<typeof advanceProtocol>[1],
  now = NOW,
  safety: ProtocolSafetyContext = {},
): ProtocolData {
  const r = advanceProtocol(protocol, event, now, safety);
  expect(r.rejection).toBeUndefined();
  return r.protocol;
}

describe("startProtocol", () => {
  it("creates a time-boxed baseline protocol with a supportive prompt", () => {
    const r = startProtocol({ trigger: "lactose", patient: "https://a.example/#me" }, {}, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.protocol.phase).toBe("baseline");
    expect(r.protocol.targetTrigger).toBe("lactose");
    expect(r.protocol.patient).toBe("https://a.example/#me");
    expect(r.protocol.phaseStarted).toEqual(NOW);
    // Time-boxed: baseline default is 5 days.
    expect(r.protocol.phasePlannedEnd?.getTime()).toBe(NOW.getTime() + 5 * 86_400_000);
    expect(r.prompt.phase).toBe("baseline");
    expect(r.prompt.message).toContain(CLINICIAN_CAVEAT);
  });

  it("RAIL: refuses gluten pre-diagnosis with a 'get tested first' message", () => {
    const r = startProtocol({ trigger: "gluten" }, { coeliacDiagnosed: false }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe("gluten-pre-diagnosis");
    expect(r.refusal.message).toMatch(/get tested first|falsely negative/i);
  });

  it("RAIL: refuses gluten for a CONFIRMED coeliac as a lifelong exclusion", () => {
    const r = startProtocol({ trigger: "gluten" }, { coeliacDiagnosed: true }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe("gluten-lifelong-exclusion");
    expect(r.refusal.message).toMatch(/lifelong|dangerous/i);
  });

  it("RAIL: refuses a trigger with an emergency (anaphylaxis) history", () => {
    const safety: ProtocolSafetyContext = { emergencyTriggers: ["sulphites"] };
    const r = startProtocol({ trigger: "sulphites" }, safety, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe("emergency-trigger");
    expect(r.refusal.message).toMatch(/emergency|supervis/i);
  });

  it("RAIL: refuses a second challenge while one is in progress (one variable at a time)", () => {
    const active: ProtocolData = { targetTrigger: "fructan", phase: "eliminate" };
    const r = startProtocol({ trigger: "lactose", existingProtocols: [active] }, {}, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe("active-challenge-exists");
  });

  it("allows a new challenge when every existing protocol has concluded", () => {
    const done: ProtocolData = { targetTrigger: "fructan", phase: "concluded" };
    const r = startProtocol({ trigger: "lactose", existingProtocols: [done] }, {}, NOW);
    expect(r.ok).toBe(true);
  });

  it("never yields a gluten protocol under any diagnosis flag (no self-run gluten path)", () => {
    for (const coeliacDiagnosed of [undefined, false, true]) {
      const r = startProtocol({ trigger: "gluten" }, { coeliacDiagnosed }, NOW);
      expect(r.ok).toBe(false);
    }
  });
});

describe("advanceProtocol — the full happy path", () => {
  it("baseline → eliminate → washout → reintroduce → observe, tolerating every dose → concluded[tolerated]", () => {
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // → eliminate
    expect(p.phase).toBe("eliminate");
    p = step(p, { type: "advance-phase", symptomsImproved: true }); // → washout
    expect(p.phase).toBe("washout");
    p = step(p, { type: "advance-phase" }); // → reintroduce (step 0)
    expect(p.phase).toBe("reintroduce");
    expect(p.challengeStep).toBe(0);

    // Walk every dose with NO reaction.
    for (let s = 0; s < DOSE_LADDER.length; s++) {
      expect(p.phase).toBe("reintroduce");
      expect(p.challengeStep).toBe(s);
      p = step(p, { type: "advance-phase" }); // take dose → observe
      expect(p.phase).toBe("observe");
      const r = advanceProtocol(p, { type: "record-outcome", reacted: false }, NOW);
      p = r.protocol;
      if (s < DOSE_LADDER.length - 1) {
        expect(p.phase).toBe("reintroduce");
        expect(p.challengeStep).toBe(s + 1);
      } else {
        expect(p.phase).toBe("concluded");
        expect(r.verdict).toBe("tolerated");
      }
    }
  });

  it("reaction at the FIRST dose → concluded[reacts]", () => {
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // eliminate
    p = step(p, { type: "advance-phase", symptomsImproved: true }); // washout
    p = step(p, { type: "advance-phase" }); // reintroduce step 0
    p = step(p, { type: "advance-phase" }); // observe step 0
    const r = advanceProtocol(p, { type: "record-outcome", reacted: true }, NOW);
    expect(r.protocol.phase).toBe("concluded");
    expect(r.verdict).toBe("reacts");
  });

  it("reaction only at a LATER dose → concluded[dose-dependent]", () => {
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // eliminate
    p = step(p, { type: "advance-phase", symptomsImproved: true }); // washout
    p = step(p, { type: "advance-phase" }); // reintroduce step 0
    p = step(p, { type: "advance-phase" }); // observe step 0
    p = step(p, { type: "record-outcome", reacted: false }); // → reintroduce step 1
    expect(p.challengeStep).toBe(1);
    p = step(p, { type: "advance-phase" }); // observe step 1
    const r = advanceProtocol(p, { type: "record-outcome", reacted: true }, NOW);
    expect(r.protocol.phase).toBe("concluded");
    expect(r.verdict).toBe("dose-dependent");
  });

  it("elimination with NO improvement → concluded[tolerated] (trigger not implicated)", () => {
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // eliminate
    const r = advanceProtocol(p, { type: "advance-phase", symptomsImproved: false }, NOW);
    expect(r.protocol.phase).toBe("concluded");
    expect(r.verdict).toBe("tolerated");
    // Absent `symptomsImproved` on eliminate is also treated as "no improvement".
    const r2 = advanceProtocol(step(freshLactose(), { type: "advance-phase" }), { type: "advance-phase" }, NOW);
    expect(r2.protocol.phase).toBe("concluded");
    expect(r2.verdict).toBe("tolerated");
  });

  it("honours a custom doseSteps count", () => {
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // eliminate
    p = step(p, { type: "advance-phase", symptomsImproved: true }); // washout
    let r = advanceProtocol(p, { type: "advance-phase" }, NOW, {}, { doseSteps: 1 }); // reintroduce
    p = r.protocol;
    r = advanceProtocol(p, { type: "advance-phase" }, NOW, {}, { doseSteps: 1 }); // observe
    p = r.protocol;
    r = advanceProtocol(p, { type: "record-outcome", reacted: false }, NOW, {}, { doseSteps: 1 });
    expect(r.protocol.phase).toBe("concluded"); // single dose ⇒ concludes after one clean dose
    expect(r.verdict).toBe("tolerated");
  });

  it("caps doseSteps to the ladder length (labels never collapse to repeated 'full')", () => {
    // doseSteps > DOSE_LADDER.length is clamped: a clean walk concludes after exactly
    // DOSE_LADDER.length doses, not the (larger) requested count.
    const opts = { doseSteps: 99 };
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // eliminate
    p = step(p, { type: "advance-phase", symptomsImproved: true }); // washout
    let r = advanceProtocol(p, { type: "advance-phase" }, NOW, {}, opts); // reintroduce 0
    p = r.protocol;
    for (let s = 0; s < DOSE_LADDER.length; s++) {
      r = advanceProtocol(p, { type: "advance-phase" }, NOW, {}, opts); // observe
      p = r.protocol;
      r = advanceProtocol(p, { type: "record-outcome", reacted: false }, NOW, {}, opts);
      p = r.protocol;
    }
    expect(p.phase).toBe("concluded");
    expect(r.verdict).toBe("tolerated");
  });
});

describe("advanceProtocol — abort (time-boxed + abortable)", () => {
  for (const phase of ["baseline", "eliminate", "washout", "reintroduce", "observe"] as const) {
    it(`aborts from ${phase} → concluded[inconclusive]`, () => {
      const p: ProtocolData = { targetTrigger: "lactose", phase, challengeStep: 0 };
      const r = advanceProtocol(p, { type: "abort", reason: "felt unwell" }, NOW);
      expect(r.rejection).toBeUndefined();
      expect(r.protocol.phase).toBe("concluded");
      expect(r.verdict).toBe("inconclusive");
    });
  }
});

describe("advanceProtocol — fail-closed rejections (no invented transitions)", () => {
  it("rejects any event on an already-concluded protocol", () => {
    const p: ProtocolData = { targetTrigger: "lactose", phase: "concluded" };
    for (const event of [
      { type: "advance-phase" } as const,
      { type: "record-outcome", reacted: true } as const,
      { type: "abort" } as const,
    ]) {
      const r = advanceProtocol(p, event, NOW);
      expect(r.rejection?.kind).toBe("already-concluded");
      expect(r.protocol).toEqual(p); // unchanged
      expect(r.verdict).toBeUndefined();
    }
  });

  it("rejects record-outcome outside observe", () => {
    for (const phase of ["baseline", "eliminate", "washout", "reintroduce"] as const) {
      // `challengeStep: 0` keeps the active-phase `reintroduce` well-formed so the
      // outcome-outside-observe rule (not the step guard) is what fires.
      const p: ProtocolData = { targetTrigger: "lactose", phase, challengeStep: 0 };
      const r = advanceProtocol(p, { type: "record-outcome", reacted: true }, NOW);
      expect(r.rejection?.kind).toBe("outcome-outside-observe");
      expect(r.protocol).toEqual(p);
    }
  });

  it("rejects advance-phase while observing (must record an outcome)", () => {
    const p: ProtocolData = { targetTrigger: "lactose", phase: "observe", challengeStep: 0 };
    const r = advanceProtocol(p, { type: "advance-phase" }, NOW);
    expect(r.rejection?.kind).toBe("invalid-transition");
    expect(r.protocol).toEqual(p);
  });

  it("rejects record-outcome without an explicit boolean `reacted`", () => {
    const p: ProtocolData = { targetTrigger: "lactose", phase: "observe", challengeStep: 0 };
    for (const reacted of [undefined, "yes", 1, null]) {
      const r = advanceProtocol(
        p,
        { type: "record-outcome", reacted } as unknown as Parameters<typeof advanceProtocol>[1],
        NOW,
      );
      expect(r.rejection?.kind).toBe("invalid-transition");
      expect(r.protocol).toEqual(p); // never concluded on ambiguous input
      expect(r.verdict).toBeUndefined();
    }
  });

  it("fails closed on an unknown/malformed phase — for EVERY event, including abort", () => {
    const p = { targetTrigger: "lactose", phase: "bogus" } as unknown as ProtocolData;
    for (const event of [
      { type: "advance-phase" } as const,
      { type: "record-outcome", reacted: true } as const,
      { type: "abort" } as const, // must NOT slip through to concluded
    ]) {
      const r = advanceProtocol(p, event, NOW);
      expect(r.rejection?.kind).toBe("invalid-transition");
      expect(r.protocol).toEqual(p); // unchanged — never transitioned to concluded
      expect(r.verdict).toBeUndefined();
    }
  });

  it("rejects an unknown/malformed event type (never an implicit advance-phase)", () => {
    const p = freshLactose();
    const r = advanceProtocol(p, { type: "bogus" } as unknown as Parameters<typeof advanceProtocol>[1], NOW);
    expect(r.rejection?.kind).toBe("invalid-transition");
    expect(r.protocol).toEqual(p);
  });

  it("rejects a non-object / null / undefined event without throwing (fail-closed)", () => {
    const p = freshLactose();
    for (const bad of [null, undefined, 42, "advance-phase", {}]) {
      const r = advanceProtocol(p, bad as unknown as Parameters<typeof advanceProtocol>[1], NOW);
      expect(r.rejection?.kind).toBe("invalid-transition");
      expect(r.protocol).toEqual(p);
    }
  });

  it("is PURE — never mutates its input protocol", () => {
    const p = freshLactose();
    const snapshot = structuredClone(p);
    advanceProtocol(p, { type: "advance-phase" }, NOW);
    expect(p).toEqual(snapshot);
  });
});

describe("HEALTH-SAFETY RAILS — defence-in-depth at washout → reintroduce", () => {
  it("re-blocks gluten at the reintroduce edge even if a gluten protocol somehow exists", () => {
    // Fabricate a gluten protocol at washout (should not exist, but prove the edge blocks it).
    const p: ProtocolData = { targetTrigger: "gluten", phase: "washout" };
    const r = advanceProtocol(p, { type: "advance-phase" }, NOW, { coeliacDiagnosed: true });
    expect(r.rejection?.kind).toBe("safety-blocked");
    expect(r.rejection?.safety?.kind).toBe("gluten-lifelong-exclusion");
    expect(r.protocol.phase).toBe("washout"); // never entered reintroduce
  });

  it("re-blocks an emergency trigger at the reintroduce edge", () => {
    const p: ProtocolData = { targetTrigger: "sulphites", phase: "washout" };
    const r = advanceProtocol(p, { type: "advance-phase" }, NOW, { emergencyTriggers: ["sulphites"] });
    expect(r.rejection?.kind).toBe("safety-blocked");
    expect(r.rejection?.safety?.kind).toBe("emergency-trigger");
    expect(r.protocol.phase).toBe("washout");
  });

  it("blocks CONCLUDING a safety-blocked observe protocol on a reaction (no confirmed verdict leaks out)", () => {
    // reacted:true would otherwise conclude[reacts] → a confirmed gluten/emergency
    // conclusion downstream. Must be refused, not concluded.
    const gluten: ProtocolData = { targetTrigger: "gluten", phase: "observe", challengeStep: 0 };
    const gr = advanceProtocol(gluten, { type: "record-outcome", reacted: true }, NOW, {
      coeliacDiagnosed: true,
    });
    expect(gr.rejection?.kind).toBe("safety-blocked");
    expect(gr.protocol.phase).toBe("observe"); // never concluded
    expect(gr.verdict).toBeUndefined();

    const emerg: ProtocolData = { targetTrigger: "sulphites", phase: "observe", challengeStep: 0 };
    const er = advanceProtocol(emerg, { type: "record-outcome", reacted: true }, NOW, {
      emergencyTriggers: ["sulphites"],
    });
    expect(er.rejection?.kind).toBe("safety-blocked");
    expect(er.verdict).toBeUndefined();
  });

  it("rejects an out-of-range challengeStep in an active phase (never skips doses)", () => {
    for (const phase of ["reintroduce", "observe"] as const) {
      for (const challengeStep of [99, -1, 1.5, undefined]) {
        const p = { targetTrigger: "lactose", phase, challengeStep } as unknown as ProtocolData;
        const event =
          phase === "observe"
            ? ({ type: "record-outcome", reacted: false } as const)
            : ({ type: "advance-phase" } as const);
        const r = advanceProtocol(p, event, NOW);
        expect(r.rejection?.kind).toBe("invalid-transition");
        expect(r.protocol).toEqual(p);
        expect(r.verdict).toBeUndefined();
      }
    }
  });

  it("abort still works on a malformed out-of-range active protocol (the escape hatch)", () => {
    const p = { targetTrigger: "lactose", phase: "observe", challengeStep: 99 } as unknown as ProtocolData;
    const r = advanceProtocol(p, { type: "abort" }, NOW);
    expect(r.rejection).toBeUndefined();
    expect(r.protocol.phase).toBe("concluded");
    expect(r.verdict).toBe("inconclusive");
  });

  it("re-blocks the NEXT DOSE (observe → reintroduce, no reaction) for a gluten/emergency protocol", () => {
    // A fabricated gluten/emergency protocol observing a clean dose must not be told
    // to reintroduce the NEXT dose — recheck the rail before looping.
    const gluten: ProtocolData = { targetTrigger: "gluten", phase: "observe", challengeStep: 0 };
    const gr = advanceProtocol(gluten, { type: "record-outcome", reacted: false }, NOW, {
      coeliacDiagnosed: true,
    });
    expect(gr.rejection?.kind).toBe("safety-blocked");
    expect(gr.rejection?.safety?.kind).toBe("gluten-lifelong-exclusion");
    expect(gr.protocol.phase).toBe("observe"); // never advanced to the next dose

    const emerg: ProtocolData = { targetTrigger: "sulphites", phase: "observe", challengeStep: 0 };
    const er = advanceProtocol(emerg, { type: "record-outcome", reacted: false }, NOW, {
      emergencyTriggers: ["sulphites"],
    });
    expect(er.rejection?.kind).toBe("safety-blocked");
    expect(er.protocol.phase).toBe("observe");
  });

  it("re-blocks the DOSE (reintroduce → observe) for a fabricated gluten/emergency protocol", () => {
    // A persisted/malformed protocol already sitting in `reintroduce` must not take a
    // dose (→ observe) without a fresh safety recheck — taking the dose IS the risk.
    const gluten: ProtocolData = { targetTrigger: "gluten", phase: "reintroduce", challengeStep: 0 };
    const gr = advanceProtocol(gluten, { type: "advance-phase" }, NOW, { coeliacDiagnosed: true });
    expect(gr.rejection?.kind).toBe("safety-blocked");
    expect(gr.protocol.phase).toBe("reintroduce"); // never advanced to observe

    const emerg: ProtocolData = { targetTrigger: "sulphites", phase: "reintroduce", challengeStep: 0 };
    const er = advanceProtocol(emerg, { type: "advance-phase" }, NOW, { emergencyTriggers: ["sulphites"] });
    expect(er.rejection?.kind).toBe("safety-blocked");
    expect(er.protocol.phase).toBe("reintroduce");
  });

  it("blocks EVERY non-abort transition for a safety-blocked trigger (incl. eliminate → tolerated)", () => {
    // The dangerous case: a fabricated gluten/emergency protocol must never conclude
    // `tolerated` (which would become a confirmed 'gluten is tolerated' conclusion).
    const safetyByTrigger: Array<[ProtocolData["targetTrigger"], ProtocolSafetyContext]> = [
      ["gluten", { coeliacDiagnosed: true }],
      ["gluten", { coeliacDiagnosed: false }],
      ["sulphites", { emergencyTriggers: ["sulphites"] }],
    ];
    for (const [trigger, safety] of safetyByTrigger) {
      for (const phase of ["baseline", "eliminate", "washout"] as const) {
        const p: ProtocolData = { targetTrigger: trigger, phase };
        // eliminate with no improvement would otherwise conclude tolerated.
        const r = advanceProtocol(p, { type: "advance-phase", symptomsImproved: false }, NOW, safety);
        expect(r.rejection?.kind).toBe("safety-blocked");
        expect(r.protocol.phase).toBe(phase); // never concluded
        expect(r.verdict).toBeUndefined();
      }
      // …but abort still works to safely close it out.
      const aborted = advanceProtocol(
        { targetTrigger: trigger, phase: "eliminate" },
        { type: "abort" },
        NOW,
        safety,
      );
      expect(aborted.rejection).toBeUndefined();
      expect(aborted.protocol.phase).toBe("concluded");
    }
  });

  it("challengeSafetyRefusal is the single chokepoint (gluten + emergency, else undefined)", () => {
    expect(challengeSafetyRefusal("gluten")?.kind).toBe("gluten-pre-diagnosis");
    expect(challengeSafetyRefusal("gluten", { coeliacDiagnosed: true })?.kind).toBe(
      "gluten-lifelong-exclusion",
    );
    expect(challengeSafetyRefusal("sulphites", { emergencyTriggers: ["sulphites"] })?.kind).toBe(
      "emergency-trigger",
    );
    expect(challengeSafetyRefusal("lactose")).toBeUndefined();
    expect(challengeSafetyRefusal("sulphites")).toBeUndefined(); // no emergency history ⇒ allowed
  });
});

describe("one-active-challenge invariant", () => {
  it("refuses washout → reintroduce while ANOTHER protocol is in progress (any non-concluded phase)", () => {
    // Stricter than the model's active-only invariant: baseline/eliminate/washout/
    // reintroduce/observe all block — one variable at a time.
    for (const otherPhase of ["baseline", "eliminate", "washout", "reintroduce", "observe"] as const) {
      const other: ProtocolData = { targetTrigger: "fructan", phase: otherPhase, challengeStep: 0 };
      const p: ProtocolData = { targetTrigger: "lactose", phase: "washout" };
      const r = advanceProtocol(p, { type: "advance-phase" }, NOW, {}, { otherProtocols: [other] });
      expect(r.rejection?.kind).toBe("safety-blocked");
      expect(r.rejection?.safety?.kind).toBe("active-challenge-exists");
      expect(r.protocol.phase).toBe("washout"); // never entered reintroduce
    }
  });

  it("allows washout → reintroduce when no other protocol is active", () => {
    const other: ProtocolData = { targetTrigger: "fructan", phase: "concluded" };
    const p: ProtocolData = { targetTrigger: "lactose", phase: "washout" };
    const r = advanceProtocol(p, { type: "advance-phase" }, NOW, {}, { otherProtocols: [other] });
    expect(r.rejection).toBeUndefined();
    expect(r.protocol.phase).toBe("reintroduce");
  });

  it("blocks WITHIN the active loop too (reintroduce→observe, observe→next dose) if another is in progress", () => {
    const other: ProtocolData = { targetTrigger: "fructan", phase: "eliminate" };
    // reintroduce → observe blocked
    const r1 = advanceProtocol(
      { targetTrigger: "lactose", phase: "reintroduce", challengeStep: 0 },
      { type: "advance-phase" },
      NOW,
      {},
      { otherProtocols: [other] },
    );
    expect(r1.rejection?.safety?.kind).toBe("active-challenge-exists");
    expect(r1.protocol.phase).toBe("reintroduce");
    // observe → next dose blocked (no reaction, more doses left)
    const r2 = advanceProtocol(
      { targetTrigger: "lactose", phase: "observe", challengeStep: 0 },
      { type: "record-outcome", reacted: false },
      NOW,
      {},
      { otherProtocols: [other] },
    );
    expect(r2.rejection?.safety?.kind).toBe("active-challenge-exists");
    expect(r2.protocol.phase).toBe("observe");
  });

  it("abort ALWAYS bypasses the one-active guard (so a conflict is resolvable)", () => {
    const other: ProtocolData = { targetTrigger: "fructan", phase: "observe", challengeStep: 0 };
    const r = advanceProtocol(
      { targetTrigger: "lactose", phase: "reintroduce", challengeStep: 0 },
      { type: "abort" },
      NOW,
      {},
      { otherProtocols: [other] },
    );
    expect(r.rejection).toBeUndefined();
    expect(r.protocol.phase).toBe("concluded");
    expect(r.verdict).toBe("inconclusive");
  });

  it("a full run is never in more than one active-challenge phase at a time", () => {
    let p = freshLactose();
    const phases = [
      { type: "advance-phase" } as const, // eliminate
      { type: "advance-phase", symptomsImproved: true } as const, // washout
      { type: "advance-phase" } as const, // reintroduce
      { type: "advance-phase" } as const, // observe
    ];
    for (const e of phases) {
      p = step(p, e);
      // At most this one protocol is ever active — the model's invariant holds.
      expect(countActiveChallenges([p])).toBeLessThanOrEqual(1);
    }
    expect(isActiveChallengePhase(p.phase)).toBe(true); // now observing
  });
});

describe("prompts — supportive, non-gamified (orthorexia guard)", () => {
  it("no gamification language on any phase prompt", () => {
    const banned = /streak|points?\b|badge|leaderboard|don't break the chain|reward/i;
    let p = freshLactose();
    const msgs: string[] = [];
    const started = startProtocol({ trigger: "lactose" }, {}, NOW);
    if (started.ok) msgs.push(started.prompt.message);
    for (const e of [
      { type: "advance-phase" } as const,
      { type: "advance-phase", symptomsImproved: true } as const,
      { type: "advance-phase" } as const,
      { type: "advance-phase" } as const,
    ]) {
      const res = advanceProtocol(p, e, NOW);
      p = res.protocol;
      if (res.prompt) msgs.push(res.prompt.message);
    }
    expect(msgs.length).toBeGreaterThanOrEqual(4);
    for (const m of msgs) expect(m).not.toMatch(banned);
  });

  it("prompt dueAt is the STORED phasePlannedEnd, not recomputed from now", () => {
    const start = startProtocol({ trigger: "lactose" }, {}, NOW);
    if (!start.ok) throw new Error("expected ok");
    // The prompt's dueAt equals the protocol's stored planned end exactly.
    expect(start.prompt.dueAt?.getTime()).toBe(start.protocol.phasePlannedEnd?.getTime());
    // Re-rendering the prompt LATER must not move the deadline (uses the stored value).
    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    const reprompt = promptFor(start.protocol);
    expect(reprompt.dueAt?.getTime()).toBe(start.protocol.phasePlannedEnd?.getTime());
    expect(reprompt.dueAt?.getTime()).not.toBe(later.getTime());
  });

  it("reintroduce/baseline prompts carry the clinician caveat", () => {
    const r = startProtocol({ trigger: "lactose" }, {}, NOW);
    if (r.ok) expect(r.prompt.message).toContain(CLINICIAN_CAVEAT);
    const p: ProtocolData = { targetTrigger: "lactose", phase: "washout" };
    const res = advanceProtocol(p, { type: "advance-phase" }, NOW);
    expect(res.prompt?.message).toContain(CLINICIAN_CAVEAT);
  });
});

describe("confirmed-conclusion gating (the scientific spine)", () => {
  it("deriveConfirmedConclusion returns undefined until the protocol has concluded", () => {
    let p = freshLactose();
    expect(deriveConfirmedConclusion(p, "tolerated")).toBeUndefined();
    p = step(p, { type: "advance-phase" }); // eliminate — still not concluded
    expect(deriveConfirmedConclusion(p, "reacts")).toBeUndefined();
  });

  it("a COMPLETED protocol yields a `confirmed` conclusion carrying the reducer's verdict", () => {
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // eliminate
    const r = advanceProtocol(p, { type: "advance-phase", symptomsImproved: false }, NOW);
    expect(r.protocol.phase).toBe("concluded");
    const verdict = r.verdict as Verdict;
    const conclusion = deriveConfirmedConclusion(r.protocol, verdict, { now: NOW });
    expect(conclusion?.confidence).toBe("confirmed");
    expect(conclusion?.aboutTrigger).toBe("lactose");
    expect(conclusion?.verdict).toBe("tolerated");
  });

  it("a time-boxed 'reacts' conclusion (lactose) carries a reviewAfter re-challenge date", () => {
    // Reach concluded[reacts] then confirm.
    let p = freshLactose();
    p = step(p, { type: "advance-phase" }); // eliminate
    p = step(p, { type: "advance-phase", symptomsImproved: true }); // washout
    p = step(p, { type: "advance-phase" }); // reintroduce
    p = step(p, { type: "advance-phase" }); // observe
    const r = advanceProtocol(p, { type: "record-outcome", reacted: true }, NOW);
    const conclusion = deriveConfirmedConclusion(r.protocol, r.verdict as Verdict, { now: NOW });
    expect(conclusion?.verdict).toBe("reacts");
    expect(conclusion?.reviewAfter).toBeInstanceOf(Date);
    // 182-day (6-month) default re-challenge horizon.
    expect(conclusion?.reviewAfter && conclusion.reviewAfter.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("read helpers", () => {
  it("isPhaseElapsed reflects the phase time-box", () => {
    const p = freshLactose(); // baseline planned end = NOW + 5d
    expect(isPhaseElapsed(p, NOW)).toBe(false);
    expect(isPhaseElapsed(p, new Date(NOW.getTime() + 6 * 86_400_000))).toBe(true);
    // A phase with no planned end (concluded) counts as elapsed.
    expect(isPhaseElapsed({ targetTrigger: "lactose", phase: "concluded" }, NOW)).toBe(true);
  });

  it("nextAction describes each live phase with an actionable label", () => {
    for (const phase of PROTOCOL_PHASES) {
      const p: ProtocolData = { targetTrigger: "lactose", phase, challengeStep: 0 };
      const na = nextAction(p, NOW);
      expect(na.label.length).toBeGreaterThan(0);
      expect(na.detail.length).toBeGreaterThan(0);
    }
    // eliminate + observe are two-outcome → no single event.
    expect(nextAction({ targetTrigger: "lactose", phase: "eliminate" }, NOW).event).toBeUndefined();
    expect(nextAction({ targetTrigger: "lactose", phase: "observe" }, NOW).event).toBeUndefined();
    // baseline/washout/reintroduce carry a single advance-phase event.
    expect(nextAction({ targetTrigger: "lactose", phase: "baseline" }, NOW).event?.type).toBe(
      "advance-phase",
    );
  });
});
