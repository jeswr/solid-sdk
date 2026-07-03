// AUTHORED-BY Claude Fable 5
/**
 * The DietPlan view (DESIGN §2.2 entity 9, Brief 4B item 2) — "what am I currently
 * avoiding, and why". It must ground each exclusion (a confirmed reaction), frame the
 * empty state positively (expansion bias, not "here's what's wrong with you"), and
 * flag a due time-boxed review as ready to re-test.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoredConclusion } from "@/lib/cache/diary-store";
import { SessionContext } from "@/lib/session/context";
import { makeSession, renderWithSession } from "../../test/session-harness";
import { DietPlanView } from "./diet-plan-view";

function conclusion(over: Partial<StoredConclusion>): StoredConclusion {
  return {
    kind: "conclusion",
    ulid: `c-${over.aboutTrigger}`,
    url: `https://alice.example/conclusions/${over.aboutTrigger}.ttl`,
    aboutTrigger: "lactose",
    verdict: "reacts",
    confidence: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
    sync: "synced",
    ...over,
  } as StoredConclusion;
}

describe("DietPlanView", () => {
  it("shows the positive empty state when nothing is being avoided", async () => {
    renderWithSession(<DietPlanView />);
    await waitFor(() =>
      expect(screen.getByText(/not avoiding anything based on your own tests yet/i)).toBeInTheDocument(),
    );
  });

  it("lists a confirmed exclusion with the reason why", async () => {
    const harness = makeSession();
    await harness.store.putConclusion(conclusion({ aboutTrigger: "lactose", verdict: "reacts" }));
    render(
      <SessionContext.Provider value={harness.value}>
        <DietPlanView />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText(/react to it/i)).toBeInTheDocument());
    expect(screen.getByText("Lactose")).toBeInTheDocument();
    expect(screen.getByText(/can ease over time/i)).toBeInTheDocument();
  });

  it("flags a lifelong (gluten) exclusion as lifelong, never review-due", async () => {
    const harness = makeSession();
    await harness.store.putConclusion(
      conclusion({
        aboutTrigger: "gluten",
        verdict: "reacts",
        reviewAfter: "2020-01-01T00:00:00.000Z",
      }),
    );
    render(
      <SessionContext.Provider value={harness.value}>
        <DietPlanView />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Gluten")).toBeInTheDocument());
    expect(screen.getByText(/lifelong/i)).toBeInTheDocument();
    expect(screen.queryByText(/ready to re-test/i)).not.toBeInTheDocument();
  });
});
