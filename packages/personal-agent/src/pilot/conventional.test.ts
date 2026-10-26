import { describe, expect, it } from "vitest";
import { runConventional } from "./scenarios/conventional.js";
import { fixedClock } from "./scenarios/personal.js";

describe("UC-02 / R25 remembered conventional scheduling service (local reference service)", () => {
  it("extracts, confirms, books deterministically, and resists poisoning, staleness and uncertainty", async () => {
    const { obs } = await runConventional(fixedClock("2026-10-19T08:00:00Z"));
    expect(obs.firstContact).toEqual({ candidates: 1, status: "candidate", forwarded: false });
    expect(obs.beforeConfirmation).toBe("blocked");
    expect(obs.confirmed).toBe("accepted");
    // 10:00 London is 09:00Z in BST and 10:00Z after the 25 Oct change; 08:00Z is rejected.
    expect(obs.bookings).toEqual({
      bst: "2026-10-20T09:00:00.000Z",
      gmt: "2026-10-26T10:00:00.000Z",
      outboundMessages: 0,
      emailsGenerated: 0,
    });
    expect(obs.repeatSameRequest).toEqual({
      status: "booked",
      newProviderPosts: 0,
      providerBookings: 2,
    });
    expect(obs.poisoned).toEqual({
      rejected: [
        "ip-literal",
        "unsupported-scheme",
        "unsupported-host",
        "credentials-in-url",
        "unsupported-port",
        "unsupported-query",
        "non-canonical-url",
      ],
      candidatesForMallory: 0,
      canaryHits: 0,
      ipv6Literal: "ip-literal",
      mateoStillAccepted: "accepted",
    });
    expect(obs.forwarded).toEqual({
      forwarded: true,
      candidateContact: "sam@example.net",
      mateoStatus: "accepted",
    });
    expect(obs.dispute).toMatchObject({
      disputed: true,
      booking: "blocked",
      afterReconfirm: "accepted",
      conflictingCandidate: "rejected",
    });
    expect(obs.uncertain).toEqual({
      afterCommit: { first: "uncertain", providerBookingsAfterTimeout: 3, afterRecovery: "booked" },
      beforeCommit: { first: "uncertain", providerBookingsBeforeRetry: 3, afterRecovery: "booked" },
      duplicateProviderBookings: 0,
    });
    expect(obs.stale).toMatchObject({ booking: "blocked", status: "changed" });
    expect(String((obs.stale as { reason: string }).reason)).toMatch(/terms changed/);
    expect(obs.expired).toMatchObject({ booking: "blocked" });
    expect(String((obs.expired as { reason: string }).reason)).toMatch(/expired/);
    expect(obs.forwardedLinkAfterConfirmation).toMatchObject({ booking: "blocked" });
    expect(String((obs.forwardedLinkAfterConfirmation as { reason: string }).reason)).toMatch(
      /re-check failed/,
    );
    expect(obs.unlistedContact).toEqual({ booking: "pending-approval" });
    expect(obs.canaryHitsTotal).toBe(0);
    expect(obs.providerLog).toEqual(
      [
        "GET /v1/bookings",
        "GET /v1/users/:u/event-types/:e",
        "GET /v1/users/:u/event-types/:e/availability",
        "POST /_control",
        "POST /v1/users/:u/event-types/:e/bookings",
      ].filter((l) => l !== "POST /_control"),
    );
    expect(obs.ledgerOk).toBe(true);
  }, 30_000);
});
