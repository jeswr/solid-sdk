// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import type { ProtocolData } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "./lag";
import { REINTRODUCTION_DEFAULTS, scheduleReintroduction } from "./reintroduction";
import { at } from "./testUtils";

const DAY_MS = 86_400_000;

function protocol(over: Partial<ProtocolData> & Pick<ProtocolData, "targetTrigger" | "phase">): ProtocolData {
  return { id: "https://pod.example/protocols/p#it", ...over };
}

describe("scheduleReintroduction — washout + dose ladder (RESEARCH §2.4)", () => {
  const now = at(0);
  const schedule = scheduleReintroduction(protocol({ targetTrigger: "lactose", phase: "reintroduce" }), { now });

  it("respects the washout before the first dose", () => {
    expect(schedule.washoutDays).toBe(REINTRODUCTION_DEFAULTS.washoutDays);
    expect(schedule.steps[0]!.scheduledFor.getTime()).toBe(now.getTime() + 3 * DAY_MS);
  });

  it("escalates small → moderate → full at the step interval", () => {
    expect(schedule.steps.map((s) => s.dose)).toEqual(["small", "moderate", "full"]);
    expect(schedule.steps[1]!.scheduledFor.getTime() - schedule.steps[0]!.scheduledFor.getTime()).toBe(3 * DAY_MS);
  });

  it("observes each dose for the trigger's own lag-max window (lactose = 6 h)", () => {
    const s0 = schedule.steps[0]!;
    expect(s0.observeUntil.getTime() - s0.scheduledFor.getTime()).toBe(6 * HOUR_MS);
  });

  it("uses gluten's much longer observe window when the trigger is gluten (72 h)", () => {
    const g = scheduleReintroduction(protocol({ targetTrigger: "gluten", phase: "reintroduce" }), { now });
    const s0 = g.steps[0]!;
    expect(s0.observeUntil.getTime() - s0.scheduledFor.getTime()).toBe(72 * HOUR_MS);
  });

  it("resumes at the protocol's challengeStep, scheduling only the REMAINING doses", () => {
    const s = scheduleReintroduction(
      protocol({ targetTrigger: "lactose", phase: "reintroduce", challengeStep: 2 }),
      { now },
    );
    // step index 2 → only the 'full' dose remains (no invented steps past the ladder).
    expect(s.steps.map((x) => x.step)).toEqual([2]);
    expect(s.steps.map((x) => x.dose)).toEqual(["full"]);
    expect(s.steps[0]!.scheduledFor.getTime()).toBe(now.getTime() + 3 * DAY_MS);
  });

  it("yields no steps when challengeStep is at/past the end of the ladder", () => {
    const s = scheduleReintroduction(
      protocol({ targetTrigger: "lactose", phase: "observe", challengeStep: 3 }),
      { now },
    );
    expect(s.steps).toEqual([]);
  });
});
