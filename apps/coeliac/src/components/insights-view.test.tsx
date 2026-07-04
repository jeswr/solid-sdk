// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Insights view acceptance (DESIGN §4): it runs the pure engine over the cached
 * diary and surfaces a lag-aware PATTERN — never a diagnosis, never "confirmed" — with
 * the always-attached honesty caveat. Emergency symptoms are excluded from correlation
 * and surface only as the emergency rail. Empty diaries get a guiding empty-state, not a
 * fabricated pattern.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
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
    // …and it is never framed as confirmed / a diagnosis — scoped to the
    // suspicion surface itself (the SEPARATE safety-context inputs elsewhere on
    // the page legitimately ask about a "CONFIRMED coeliac diagnosis", which is
    // not a claim the ENGINE is making about this suspicion).
    const suspicionsSection = within(screen.getByLabelText(/possible patterns/i));
    expect(suspicionsSection.queryByText(/confirmed/i)).not.toBeInTheDocument();
    expect(suspicionsSection.queryByText(/you have/i)).not.toBeInTheDocument();
  });

  it("persists a locally-learned per-user lag profile once a suspicion reaches the 'likely' tier (data-flow fix, deliverable 5)", async () => {
    const harness = makeSession();
    // 6 lactose exposures, each followed ~2h later — dense + consistent enough to
    // reach the engine's strongest ("likely") correlation tier.
    for (let d = 0; d < 6; d++) {
      await harness.store.putMeal(lactoseMeal(d));
      await harness.store.putSymptom(symptomAfter(d, 2));
    }
    render(
      <SessionContext.Provider value={harness.value}>
        <InsightsView />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Likely/i).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    // The cache module now holds a locally-learned lactose lag profile — never
    // fetched, never sent over the network, purely derived from the evidence the
    // engine already computed.
    await waitFor(async () => {
      const learned = await harness.store.allTriggerClasses();
      expect(learned.map((t) => t.slug)).toContain("lactose");
    });
  });

  it("reads back a previously-learned per-user lag window instead of the model's evidence prior (data-flow fix, deliverable 5)", async () => {
    const harness = makeSession();
    // A custom, per-user profile distinct from lactose's evidence prior (0.5–6h).
    await harness.store.putTriggerClass({
      kind: "triggerClass",
      slug: "lactose",
      lagWindowMin: 1,
      lagWindowMax: 3,
      lagMode: 2,
      sampleSize: 5,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    // A single exposure→symptom pair at 2h — inside BOTH the custom window and the
    // prior, so this only tests which window is DISPLAYED, not correlation counts.
    await harness.store.putMeal(lactoseMeal(0));
    await harness.store.putSymptom(symptomAfter(0, 2));
    render(
      <SessionContext.Provider value={harness.value}>
        <InsightsView />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(screen.getAllByText(/Lactose/i).length).toBeGreaterThan(0), {
      timeout: 3000,
    });
    // The custom per-user window is used — not the model's 0.5–6h evidence prior.
    expect(screen.getByText(/within a 1–3h window/i)).toBeInTheDocument();
    expect(screen.queryByText(/within a 0\.5–6h window/i)).not.toBeInTheDocument();
  });
});
