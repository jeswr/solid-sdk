// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * DiaryStore.hasMealContext — the full-cache eating-out signal (Phase 4A, design
 * §3.2). Regression cover for the roborev Medium: the surfacing must find a
 * restaurant meal EVEN WHEN it is beyond the recent-window cap OR hidden behind a
 * newer same-signature non-restaurant meal (both drop it from `recentMeals()`).
 */
import type { MealContext } from "@jeswr/solid-health-diary";
import { describe, expect, it } from "vitest";
import { DiaryStore, type StoredMeal } from "./diary-store.js";
import { MemoryKv } from "./kv.js";

function meal(overrides: Partial<StoredMeal> & { ulid: string; startTime: string }): StoredMeal {
  return {
    kind: "meal",
    url: `https://alice.example/health/diary/meals/${overrides.ulid}`,
    createdAt: overrides.startTime,
    items: [],
    exposures: [],
    signature: overrides.signature ?? `sig-${overrides.ulid}`,
    label: overrides.label ?? "Meal",
    sync: "synced",
    ...overrides,
  };
}

async function seed(meals: StoredMeal[]): Promise<DiaryStore> {
  const store = new DiaryStore(new MemoryKv(), "https://alice.example/profile/card#me");
  for (const m of meals) await store.putMeal(m);
  return store;
}

describe("DiaryStore.hasMealContext", () => {
  it("returns false when no meal has the context", async () => {
    const store = await seed([meal({ ulid: "a", startTime: "2026-07-01T10:00:00Z", context: "home" })]);
    expect(await store.hasMealContext("restaurant")).toBe(false);
  });

  it("finds a restaurant meal hidden behind a newer same-signature non-restaurant meal", async () => {
    const store = await seed([
      // Newer, same signature, NOT a restaurant — this is what recentMeals() keeps.
      meal({ ulid: "new", startTime: "2026-07-02T12:00:00Z", context: "home", signature: "pizza" }),
      // Older restaurant meal with the same signature — dropped by recentMeals() dedup.
      meal({ ulid: "old", startTime: "2026-07-01T12:00:00Z", context: "restaurant", signature: "pizza" }),
    ]);
    // The deduped recent list would miss it…
    const recent = await store.recentMeals();
    expect(recent.some((m) => m.context === "restaurant")).toBe(false);
    // …but the full-cache signal finds it.
    expect(await store.hasMealContext("restaurant")).toBe(true);
  });

  it("finds a restaurant meal beyond the recent-window cap", async () => {
    const meals: StoredMeal[] = [];
    // 10 newer home meals (distinct signatures) push the restaurant meal past the cap of 8.
    for (let i = 0; i < 10; i++) {
      meals.push(
        meal({ ulid: `home${i}`, startTime: `2026-07-1${i}T10:00:00Z`, context: "home", signature: `s${i}` }),
      );
    }
    meals.push(meal({ ulid: "resto", startTime: "2026-07-01T10:00:00Z", context: "restaurant", signature: "sr" }));
    const store = await seed(meals);
    const recent = await store.recentMeals();
    expect(recent.some((m) => m.context === "restaurant")).toBe(false); // outside the window
    expect(await store.hasMealContext("restaurant")).toBe(true);
  });

  it("matches an arbitrary context exactly", async () => {
    const store = await seed([meal({ ulid: "t", startTime: "2026-07-01T10:00:00Z", context: "travel" })]);
    const travel: MealContext = "travel";
    expect(await store.hasMealContext(travel)).toBe(true);
    expect(await store.hasMealContext("restaurant")).toBe(false);
  });
});
