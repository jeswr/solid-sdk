// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.

import { describe, expect, it } from "vitest";
import {
  buildSymptom,
  isEmergency,
  isEmergencySymptomType,
  parseSymptom,
  parseSymptomTtl,
  type SymptomData,
  serializeSymptom,
  symptomSubject,
} from "./symptom.js";

const URL_ = "https://alice.pod.example/health/diary/symptoms/2026/07/01.ttl";
const ME = "https://alice.pod.example/profile/card#me";

describe("Symptom round-trip (parse∘build == identity)", () => {
  it("a fully-populated symptom round-trips through Turtle", async () => {
    const data: SymptomData = {
      id: symptomSubject(URL_),
      symptomType: "bloating",
      onset: new Date("2026-07-01T14:00:00.000Z"),
      severity: 6,
      note: "after brunch",
      patient: ME,
      created: new Date("2026-07-01T14:05:00.000Z"),
    };
    const parsed = await parseSymptomTtl(URL_, await serializeSymptom(URL_, data));
    expect(parsed).toEqual(data);
  });

  it("rejects a Symptom with NO onset time (never coerces to the 1970 epoch)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:Symptom ; diet:symptomType diet:bloating .
    `;
    expect(await parseSymptomTtl(URL_, ttl)).toBeUndefined();
  });

  it("a minimal symptom (type + onset) round-trips", () => {
    const data: SymptomData = {
      id: symptomSubject(URL_),
      symptomType: "headache",
      onset: new Date("2026-07-01T20:00:00.000Z"),
      created: new Date("2026-07-01T20:00:00.000Z"),
    };
    expect(parseSymptom(URL_, buildSymptom(URL_, data))).toEqual(data);
  });
});

describe("Symptom severity is an ordinal 0–10 (enforced in code)", () => {
  const base: SymptomData = {
    id: symptomSubject(URL_),
    symptomType: "bloating",
    onset: new Date("2026-07-01T14:00:00.000Z"),
    created: new Date("2026-07-01T14:00:00.000Z"),
  };

  it("buildSymptom accepts the boundary values 0 and 10", () => {
    expect(() => buildSymptom(URL_, { ...base, severity: 0 })).not.toThrow();
    expect(() => buildSymptom(URL_, { ...base, severity: 10 })).not.toThrow();
    expect(parseSymptom(URL_, buildSymptom(URL_, { ...base, severity: 0 }))?.severity).toBe(0);
  });

  it("buildSymptom FAILS CLOSED on a missing/non-canonical symptomType or missing onset", () => {
    expect(() => buildSymptom(URL_, { onset: base.onset } as unknown as SymptomData)).toThrow(
      /symptomType/,
    );
    expect(() =>
      buildSymptom(URL_, {
        symptomType: "not-a-symptom",
        onset: base.onset,
      } as unknown as SymptomData),
    ).toThrow(/symptomType/);
    expect(() => buildSymptom(URL_, { symptomType: "bloating" } as unknown as SymptomData)).toThrow(
      /onset/,
    );
    expect(() => buildSymptom(URL_, { symptomType: "bloating", onset: new Date("nope") })).toThrow(
      /onset/,
    );
  });

  it("buildSymptom FAILS CLOSED on an out-of-range or non-integer severity", () => {
    expect(() => buildSymptom(URL_, { ...base, severity: 11 })).toThrow(/0–10/);
    expect(() => buildSymptom(URL_, { ...base, severity: -1 })).toThrow(/0–10/);
    expect(() => buildSymptom(URL_, { ...base, severity: 3.5 })).toThrow(/0–10/);
    expect(() => buildSymptom(URL_, { ...base, severity: Number.NaN })).toThrow(/0–10/);
  });

  it("parseSymptom DROPS an out-of-range severity from an untrusted document", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Symptom ;
        diet:symptomType diet:bloating ;
        schema:startTime "2026-07-01T14:00:00.000Z"^^xsd:dateTime ;
        diet:severity 99 .`;
    const parsed = await parseSymptomTtl(URL_, ttl);
    expect(parsed).toBeDefined();
    expect(parsed?.severity).toBeUndefined(); // 99 is out of the 0–10 ordinal range → dropped
  });
});

describe("emergency symptom flagging (RESEARCH §4 safety rail)", () => {
  it("wheeze-breathing + anaphylaxis are emergencies; ordinary GI symptoms are not", () => {
    expect(isEmergencySymptomType("wheeze-breathing")).toBe(true);
    expect(isEmergencySymptomType("anaphylaxis")).toBe(true);
    expect(isEmergencySymptomType("bloating")).toBe(false);
    expect(isEmergency({ symptomType: "wheeze-breathing" })).toBe(true);
    expect(isEmergency({ symptomType: "nausea" })).toBe(false);
  });
});
