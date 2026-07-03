// AUTHORED-BY Claude Fable 5
/**
 * Eating-out context clustering ON the Insights surface (Brief 4B item 1, DESIGN
 * §2.2/§4). When restaurant meals cluster with symptoms, the Insights view shows a
 * counts-first "where your reactions happen" section carrying the honesty caveat —
 * an inference-adjacent surface, never a diagnosis.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoredMeal, StoredSymptom } from "@/lib/cache/diary-store";
import type { MealContext } from "@jeswr/solid-health-diary";
import { SessionContext } from "@/lib/session/context";
import { makeSession } from "../../test/session-harness";
import { InsightsView } from "./insights-view";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BASE = Date.parse("2026-01-01T08:00:00.000Z");

function meal(day: number, context: MealContext): StoredMeal {
  const t = new Date(BASE + day * DAY);
  return {
    kind: "meal",
    ulid: `meal-${context}-${day}`,
    url: `https://alice.example/meals/${context}-${day}.ttl`,
    startTime: t.toISOString(),
    createdAt: t.toISOString(),
    context,
    items: [{ name: "dish" }],
    exposures: [],
    signature: `n:dish-${day}`,
    label: "dish",
    sync: "synced",
  };
}

function symptom(day: number, hours: number): StoredSymptom {
  const t = new Date(BASE + day * DAY + hours * HOUR);
  return {
    kind: "symptom",
    ulid: `sym-${day}`,
    url: `https://alice.example/symptoms/${day}.ttl`,
    symptomType: "bloating",
    onset: t.toISOString(),
    createdAt: t.toISOString(),
    severity: 5,
    sync: "synced",
  };
}

describe("InsightsView — eating-out clustering", () => {
  it("surfaces a restaurant-meal cluster with counts and the caveat", async () => {
    const harness = makeSession();
    // 5 restaurant meals, each followed by a symptom; 5 home meals, none followed.
    for (let d = 0; d < 5; d++) {
      await harness.store.putMeal(meal(d, "restaurant"));
      await harness.store.putSymptom(symptom(d, 3));
    }
    for (let d = 10; d < 15; d++) await harness.store.putMeal(meal(d, "home"));

    render(
      <SessionContext.Provider value={harness.value}>
        <InsightsView />
      </SessionContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getByText(/where your reactions happen/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/5 of your 5 restaurant meals/i)).toBeInTheDocument();
    // Inference-adjacent → carries the "pattern in your data, not a diagnosis" caveat.
    expect(screen.getAllByText(/pattern in your data/i).length).toBeGreaterThan(0);
  });

  it("does not surface the section without enough restaurant meals", async () => {
    const harness = makeSession();
    // Only 2 restaurant meals — below the min-samples guard.
    for (let d = 0; d < 2; d++) {
      await harness.store.putMeal(meal(d, "restaurant"));
      await harness.store.putSymptom(symptom(d, 3));
    }
    render(
      <SessionContext.Provider value={harness.value}>
        <InsightsView />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText(/Possible patterns/i)).toBeInTheDocument());
    expect(screen.queryByText(/where your reactions happen/i)).not.toBeInTheDocument();
  });
});
