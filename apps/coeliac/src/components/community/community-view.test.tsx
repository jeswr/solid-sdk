// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * CommunityView acceptance (Phase 4A, design §3):
 *  - the curated catalog renders;
 *  - the not-medical-advice frame + the distinct peer-content banner are present;
 *  - the eating-out surfacing fires ONLY when the diary has a `diet:context =
 *    restaurant` meal;
 *  - NO community content is fetched (link-out only).
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { StoredMeal } from "@/lib/cache/diary-store";
import { COMMUNITY_HOSTS } from "@/lib/community/allowlist";
import { NOT_MEDICAL_ADVICE } from "@/components/medical-disclaimer";
import { SessionContext } from "@/lib/session/context";
import { CommunityView } from "./community-view";
import { PEER_CONTENT_NOTE } from "./peer-content-banner";
import { makeSession, type SessionHarness } from "../../../test/session-harness";

function restaurantMeal(): StoredMeal {
  return {
    kind: "meal",
    ulid: "01MEALRESTAURANT",
    url: "https://alice.example/health/diary/meals/01MEALRESTAURANT",
    startTime: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    context: "restaurant",
    items: [],
    exposures: [],
    signature: "sig-restaurant",
    label: "Pizza out",
    sync: "synced",
  };
}

/** Render with a seeded store (seed BEFORE render so the load effect sees it). */
async function renderSeeded(ui: ReactElement, seed?: StoredMeal): Promise<SessionHarness> {
  const harness = makeSession();
  if (seed) await harness.store.putMeal(seed);
  render(<SessionContext.Provider value={harness.value}>{ui}</SessionContext.Provider>);
  return harness;
}

describe("CommunityView", () => {
  it("renders the catalog + both safety banners", async () => {
    await renderSeeded(<CommunityView />);
    expect(screen.getByRole("heading", { name: "Community", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(NOT_MEDICAL_ADVICE)).toBeInTheDocument();
    expect(screen.getByText(PEER_CONTENT_NOTE)).toBeInTheDocument();
    // A few curated entries are present as visitable links.
    expect(screen.getByRole("link", { name: /Visit Coeliac UK — support & community/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Visit r\/Celiac on Reddit/ })).toBeInTheDocument();
  });

  it("does NOT surface eating-out without a restaurant meal", async () => {
    await renderSeeded(<CommunityView />);
    // Wait for a stable always-present section, then assert the contextual one is absent.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Peer forums/ })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: /You've logged eating out/ })).not.toBeInTheDocument();
  });

  it("surfaces the venue-guide link-outs when a restaurant meal exists (diet:context=restaurant)", async () => {
    await renderSeeded(<CommunityView />, restaurantMeal());
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /You've logged eating out/ })).toBeInTheDocument(),
    );
    // The eating-out section offers the venue guides.
    const section = screen.getByRole("region", { name: "Eating out — suggested from your diary" });
    expect(section).toHaveTextContent(/Coeliac UK — GF-accredited venue guide/);
    expect(section).toHaveTextContent(/Find Me Gluten Free/);
  });

  it("fetches NO community content (link-out only)", async () => {
    const harness = await renderSeeded(<CommunityView />, restaurantMeal());
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /You've logged eating out/ })).toBeInTheDocument(),
    );
    // No request is ever made to any community host — the view is pure link-out.
    for (const call of harness.fetchMock.calls) {
      for (const host of COMMUNITY_HOSTS) expect(call.url).not.toContain(host);
    }
  });
});
