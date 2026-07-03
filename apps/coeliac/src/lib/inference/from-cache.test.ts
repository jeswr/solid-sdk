// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The cache→engine bridge: cached meals/symptoms map to the engine's Date-based
 * snapshot, and a record whose timestamp does not parse is DROPPED (fail-closed lag
 * anchoring) rather than fed to the engine as a NaN date.
 */
import { describe, expect, it } from "vitest";
import type { StoredMeal, StoredSymptom } from "../cache/diary-store.js";
import { diaryDataFromCache, storedMealToData, storedSymptomToData } from "./from-cache.js";

function storedMeal(over: Partial<StoredMeal> = {}): StoredMeal {
  return {
    kind: "meal",
    ulid: "01ABC",
    url: "https://pod.example/meals/2026/01/01ABC.ttl",
    startTime: "2026-01-01T08:00:00.000Z",
    createdAt: "2026-01-01T08:00:00.000Z",
    items: [{ name: "yoghurt" }],
    exposures: [{ trigger: "lactose", exposureLevel: "present" }],
    signature: "n:yoghurt",
    label: "yoghurt",
    sync: "synced",
    ...over,
  };
}

function storedSymptom(over: Partial<StoredSymptom> = {}): StoredSymptom {
  return {
    kind: "symptom",
    ulid: "01SYM",
    url: "https://pod.example/symptoms/2026/01/01SYM.ttl",
    symptomType: "bloating",
    onset: "2026-01-01T10:00:00.000Z",
    createdAt: "2026-01-01T10:00:00.000Z",
    severity: 4,
    sync: "synced",
    ...over,
  };
}

describe("storedMealToData", () => {
  it("maps a cached meal to a MealData with a real Date + its exposures", () => {
    const data = storedMealToData(storedMeal());
    expect(data).toBeDefined();
    expect(data?.id).toBe("https://pod.example/meals/2026/01/01ABC.ttl");
    expect(data?.startTime.toISOString()).toBe("2026-01-01T08:00:00.000Z");
    expect(data?.exposures).toEqual([{ trigger: "lactose", exposureLevel: "present" }]);
  });

  it("drops a meal whose ingestion time does not parse", () => {
    expect(storedMealToData(storedMeal({ startTime: "not-a-date" }))).toBeUndefined();
  });
});

describe("storedSymptomToData", () => {
  it("maps a cached symptom to a SymptomData with a real onset Date", () => {
    const data = storedSymptomToData(storedSymptom());
    expect(data?.symptomType).toBe("bloating");
    expect(data?.onset.toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(data?.severity).toBe(4);
  });

  it("drops a symptom whose onset does not parse", () => {
    expect(storedSymptomToData(storedSymptom({ onset: "" }))).toBeUndefined();
  });
});

describe("diaryDataFromCache", () => {
  it("builds a DiaryData over the valid records and skips unparseable ones", () => {
    const diary = diaryDataFromCache(
      [storedMeal(), storedMeal({ ulid: "bad", startTime: "nope" })],
      [storedSymptom(), storedSymptom({ ulid: "bad", onset: "nope" })],
    );
    expect(diary.meals).toHaveLength(1);
    expect(diary.symptoms).toHaveLength(1);
  });

  it("returns empty lists for empty input (no throw)", () => {
    const diary = diaryDataFromCache([], []);
    expect(diary.meals).toEqual([]);
    expect(diary.symptoms).toEqual([]);
  });

  it("maps cached protocols + conclusions into the DiaryData snapshot", () => {
    const diary = diaryDataFromCache(
      [],
      [],
      [
        {
          kind: "protocol",
          ulid: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          url: "https://alice.example/health/diary/protocols/p.ttl",
          targetTrigger: "lactose",
          phase: "observe",
          challengeStep: 1,
          createdAt: "2026-07-01T08:00:00.000Z",
          updatedAt: "2026-07-01T08:00:00.000Z",
          sync: "synced",
        },
      ],
      [
        {
          kind: "conclusion",
          ulid: "01ARZ3NDEKTSV4RRFFQ69G5FBW",
          url: "https://alice.example/health/diary/conclusions/c.ttl",
          aboutTrigger: "lactose",
          verdict: "reacts",
          confidence: "confirmed",
          createdAt: "2026-07-10T08:00:00.000Z",
          sync: "synced",
        },
      ],
    );
    expect(diary.protocols).toHaveLength(1);
    expect(diary.protocols?.[0].phase).toBe("observe");
    expect(diary.conclusions).toHaveLength(1);
    expect(diary.conclusions?.[0].confidence).toBe("confirmed");
  });
});
