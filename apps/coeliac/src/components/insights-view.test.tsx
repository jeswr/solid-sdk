// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Insights view acceptance (DESIGN §4): it runs the pure engine over the cached
 * diary and surfaces a lag-aware PATTERN — never a diagnosis, never "confirmed" — with
 * the always-attached honesty caveat. Emergency symptoms are excluded from correlation
 * and surface only as the emergency rail. Empty diaries get a guiding empty-state, not a
 * fabricated pattern.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoredMeal, StoredSymptom } from "@/lib/cache/diary-store";
import { SessionContext } from "@/lib/session/context";
import { makeSession, renderWithSession } from "../../test/session-harness";
import { InsightsView } from "./insights-view";

const DAY_MS = 24 * 3_600_000;
const BASE = Date.parse("2026-01-01T08:00:00.000Z");

function lactoseMeal(dayOffset: number): StoredMeal {
  const t = new Date(BASE + dayOffset * DAY_MS);
  return {
    kind: "meal",
    ulid: `meal-${dayOffset}`,
    url: `https://alice.example/meals/${dayOffset}.ttl`,
    startTime: t.toISOString(),
    createdAt: t.toISOString(),
    items: [{ name: "latte" }],
    exposures: [{ trigger: "lactose", exposureLevel: "present" }],
    signature: "n:latte",
    label: "latte",
    sync: "synced",
  };
}

function symptomAfter(dayOffset: number, hours: number, symptomType = "bloating"): StoredSymptom {
  const t = new Date(BASE + dayOffset * DAY_MS + hours * 3_600_000);
  return {
    kind: "symptom",
    ulid: `sym-${dayOffset}-${symptomType}`,
    url: `https://alice.example/symptoms/${dayOffset}-${symptomType}.ttl`,
    symptomType: symptomType as StoredSymptom["symptomType"],
    onset: t.toISOString(),
    createdAt: t.toISOString(),
    severity: 5,
    sync: "synced",
  };
}

describe("InsightsView", () => {
  it("guides the user when there is nothing (or too little) to analyse", async () => {
    renderWithSession(<InsightsView />);
    await waitFor(() =>
      expect(screen.getByText(/need both meals and symptoms/i)).toBeInTheDocument(),
    );
    // The honesty caveat is present even on the empty state.
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
  });

  it("surfaces a lag-aware pattern with the honesty caveat, never a diagnosis", async () => {
    // Seed the store BEFORE mounting so the view's first read sees the diary.
    const harness = makeSession();
    // Four lactose exposures, each followed by bloating ~2h later (inside the 0.5–6h window).
    for (let d = 0; d < 4; d++) {
      await harness.store.putMeal(lactoseMeal(d));
      await harness.store.putSymptom(symptomAfter(d, 2));
    }
    render(
      <SessionContext.Provider value={harness.value}>
        <InsightsView />
      </SessionContext.Provider>,
    );

    await waitFor(() => expect(screen.getAllByText(/Lactose/i).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    // A pattern is shown as a suspicion, with the "pattern not diagnosis" caveat…
    expect(screen.getAllByText(/pattern in your data/i).length).toBeGreaterThan(0);
    // …and it is never framed as confirmed / a diagnosis.
    expect(screen.queryByText(/confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you have/i)).not.toBeInTheDocument();
  });
});
