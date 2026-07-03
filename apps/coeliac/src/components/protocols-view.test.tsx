// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Protocols / Challenges view acceptance (Brief 2B): it runs a real challenge
 * end-to-end over the cached FSM — advance a phase, record an outcome, reach a
 * `confirmed` conclusion — and lets the user stop (abort) at any time. All with a
 * stubbed fetch + memory store (no server). Health-safety refusals come from the pure
 * FSM; this proves the UI surfaces them and never bypasses them.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoredProtocol } from "@/lib/cache/diary-store";
import { SessionContext } from "@/lib/session/context";
import { makeSession } from "../../test/session-harness";
import { ProtocolsView } from "./protocols-view";

function protocol(overrides: Partial<StoredProtocol> = {}): StoredProtocol {
  return {
    kind: "protocol",
    ulid: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    url: "https://alice.example/health/diary/protocols/01ARZ3NDEKTSV4RRFFQ69G5FAV.ttl",
    targetTrigger: "lactose",
    phase: "reintroduce",
    challengeStep: 2, // last dose (default ladder has 3) → a clean dose concludes
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    sync: "synced",
    ...overrides,
  };
}

describe("ProtocolsView", () => {
  it("advances a challenge to a confirmed conclusion", async () => {
    const harness = makeSession();
    await harness.store.putProtocol(protocol());
    render(
      <SessionContext.Provider value={harness.value}>
        <ProtocolsView />
      </SessionContext.Provider>,
    );

    // Active challenge is shown, in its reintroduce phase, with the take-dose action.
    await waitFor(() => expect(screen.getByText("Reintroducing")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /take the full dose/i }));

    // Now observing — record no reaction on the last dose → concludes `tolerated`.
    await waitFor(() => expect(screen.getByText("Observing")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /no reaction/i }));

    // The concluded section shows the confirmed verdict.
    await waitFor(() => expect(screen.getByText("Tolerated")).toBeInTheDocument());
    // A confirmed conclusion was persisted to the cache.
    await waitFor(async () => expect((await harness.store.allConclusions()).length).toBe(1));
    const conclusion = (await harness.store.allConclusions())[0];
    expect(conclusion.confidence).toBe("confirmed");
    expect(conclusion.verdict).toBe("tolerated");
  });

  it("lets the user stop a challenge (abort → inconclusive)", async () => {
    const harness = makeSession();
    await harness.store.putProtocol(protocol({ phase: "baseline", challengeStep: undefined }));
    render(
      <SessionContext.Provider value={harness.value}>
        <ProtocolsView />
      </SessionContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("Baseline")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /stop this challenge/i }));
    await waitFor(() => expect(screen.getByText(/No challenge is running/i)).toBeInTheDocument());
    const [p] = await harness.store.allProtocols();
    expect(p.phase).toBe("concluded");
  });

  it("blocks starting a second challenge while one is in progress (one variable at a time)", async () => {
    const harness = makeSession();
    await harness.store.putProtocol(protocol({ phase: "eliminate", challengeStep: undefined }));
    render(
      <SessionContext.Provider value={harness.value}>
        <ProtocolsView />
      </SessionContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Finish or stop your current challenge first/i)).toBeInTheDocument(),
    );
  });
});
