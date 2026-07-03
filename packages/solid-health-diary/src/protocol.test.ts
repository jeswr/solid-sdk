// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.

import { describe, expect, it } from "vitest";
import {
  assertSingleActiveChallenge,
  buildProtocol,
  countActiveChallenges,
  hasSingleActiveChallenge,
  isActiveChallengePhase,
  type ProtocolData,
  parseProtocol,
  parseProtocolTtl,
  protocolSubject,
  serializeProtocol,
} from "./protocol.js";

const URL_ = "https://alice.pod.example/health/diary/protocols/01.ttl";
const ME = "https://alice.pod.example/profile/card#me";

describe("EliminationProtocol round-trip (parse∘build == identity)", () => {
  it("a fully-populated protocol round-trips through Turtle", async () => {
    const data: ProtocolData = {
      id: protocolSubject(URL_),
      targetTrigger: "lactose",
      phase: "reintroduce",
      phaseStarted: new Date("2026-07-01T00:00:00.000Z"),
      phasePlannedEnd: new Date("2026-07-04T00:00:00.000Z"),
      challengeStep: 2,
      patient: ME,
      created: new Date("2026-06-30T00:00:00.000Z"),
    };
    const parsed = await parseProtocolTtl(URL_, await serializeProtocol(URL_, data));
    expect(parsed).toEqual(data);
  });

  it("a minimal protocol (targetTrigger + phase) round-trips", () => {
    const data: ProtocolData = {
      id: protocolSubject(URL_),
      targetTrigger: "sulphites",
      phase: "baseline",
      created: new Date("2026-06-30T00:00:00.000Z"),
    };
    expect(parseProtocol(URL_, buildProtocol(URL_, data))).toEqual(data);
  });
});

describe("one-active-challenge invariant (DESIGN §3)", () => {
  it("reintroduce + observe are active challenges; other phases are not", () => {
    expect(isActiveChallengePhase("reintroduce")).toBe(true);
    expect(isActiveChallengePhase("observe")).toBe(true);
    for (const p of ["baseline", "eliminate", "washout", "concluded"] as const) {
      expect(isActiveChallengePhase(p)).toBe(false);
    }
  });

  it("counts active challenges and allows at most one", () => {
    const protocols: Pick<ProtocolData, "phase">[] = [
      { phase: "observe" },
      { phase: "baseline" },
      { phase: "concluded" },
    ];
    expect(countActiveChallenges(protocols)).toBe(1);
    expect(hasSingleActiveChallenge(protocols)).toBe(true);
    expect(() => assertSingleActiveChallenge(protocols)).not.toThrow();
  });

  it("flags + throws when TWO protocols are in an active-challenge phase", () => {
    const protocols: Pick<ProtocolData, "phase">[] = [
      { phase: "reintroduce" },
      { phase: "observe" },
    ];
    expect(countActiveChallenges(protocols)).toBe(2);
    expect(hasSingleActiveChallenge(protocols)).toBe(false);
    expect(() => assertSingleActiveChallenge(protocols)).toThrow(/one-active-challenge/);
  });

  it("zero active challenges is fine", () => {
    expect(hasSingleActiveChallenge([{ phase: "baseline" }])).toBe(true);
    expect(() => assertSingleActiveChallenge([])).not.toThrow();
  });
});

describe("buildProtocol fail-closed on required coded values (SHACL MUSTs)", () => {
  it("throws on a missing or non-canonical targetTrigger", () => {
    expect(() => buildProtocol(URL_, { phase: "baseline" } as unknown as ProtocolData)).toThrow(
      /targetTrigger/,
    );
    expect(() =>
      buildProtocol(URL_, {
        targetTrigger: "not-a-trigger",
        phase: "baseline",
      } as unknown as ProtocolData),
    ).toThrow(/targetTrigger/);
  });

  it("throws on a negative/fractional/NaN challengeStep and drops an invalid parsed one", async () => {
    const base = {
      targetTrigger: "lactose" as const,
      phase: "reintroduce" as const,
      created: new Date("2026-06-30T00:00:00.000Z"),
    };
    expect(() => buildProtocol(URL_, { ...base, challengeStep: -1 })).toThrow(/challengeStep/);
    expect(() => buildProtocol(URL_, { ...base, challengeStep: 1.5 })).toThrow(/challengeStep/);
    expect(() => buildProtocol(URL_, { ...base, challengeStep: Number.NaN })).toThrow(
      /challengeStep/,
    );
    // A hostile document with a negative challengeStep parses back with it dropped.
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:EliminationProtocol ;
        diet:targetTrigger diet:lactose ;
        diet:phase diet:reintroduce ;
        diet:challengeStep "-3"^^xsd:integer .`;
    const parsed = await parseProtocolTtl(URL_, ttl);
    expect(parsed).toBeDefined();
    expect(parsed?.challengeStep).toBeUndefined();
  });

  it("throws on a missing or non-canonical phase", () => {
    expect(() =>
      buildProtocol(URL_, { targetTrigger: "lactose" } as unknown as ProtocolData),
    ).toThrow(/phase/);
    expect(() =>
      buildProtocol(URL_, {
        targetTrigger: "lactose",
        phase: "bogus",
      } as unknown as ProtocolData),
    ).toThrow(/phase/);
  });
});
