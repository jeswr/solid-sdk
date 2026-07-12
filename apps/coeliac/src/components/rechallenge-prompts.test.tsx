// AUTHORED-BY Claude Fable 5
/**
 * Home-screen re-challenge prompts (Brief 4B item 3). A time-boxed exclusion whose
 * review date has arrived is surfaced on home so the avoid-list can shrink. The
 * SAFETY RAIL is the load-bearing case: gluten/coeliac is a LIFELONG exclusion and
 * must NEVER be surfaced for re-challenge — this test would go red if the surfacing
 * ever trusted a stray `reviewAfter` on a non-time-boxed trigger.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoredConclusion } from "@/lib/cache/diary-store";
import { SessionContext } from "@/lib/session/context";
import { makeSession, renderWithSession } from "../../test/session-harness";
import { ReChallengePrompts } from "./rechallenge-prompts";

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

describe("ReChallengePrompts", () => {
  it("renders nothing when no review is due", async () => {
    const { rendered } = renderWithSession(<ReChallengePrompts />);
    // Give the cache read a tick; the section must still be absent.
    await waitFor(() => expect(rendered.container.querySelector(".rechallenge")).toBeNull());
  });

  it("surfaces a due time-boxed exclusion (lactose) with a re-test CTA", async () => {
    const harness = makeSession();
    await harness.store.putConclusion(
      conclusion({ aboutTrigger: "lactose", reviewAfter: "2020-01-01T00:00:00.000Z" }),
    );
    render(
      <SessionContext.Provider value={harness.value}>
        <ReChallengePrompts />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText(/Ready to re-test/i)).toBeInTheDocument());
    expect(screen.getByText("Lactose")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /re-challenge/i })).toBeInTheDocument();
  });

  it("SAFETY: never surfaces gluten for re-challenge even with a past review date", async () => {
    const harness = makeSession();
    await harness.store.putConclusion(
      conclusion({ aboutTrigger: "gluten", verdict: "reacts", reviewAfter: "2020-01-01T00:00:00.000Z" }),
    );
    const { container } = render(
      <SessionContext.Provider value={harness.value}>
        <ReChallengePrompts />
      </SessionContext.Provider>,
    );
    // A tick for the cache read, then assert the prompt never appeared.
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".rechallenge")).toBeNull();
    expect(screen.queryByText("Gluten")).not.toBeInTheDocument();
  });
});
