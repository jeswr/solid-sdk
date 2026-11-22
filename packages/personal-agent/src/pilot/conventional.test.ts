import { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { SlotsService } from "./domains/conventional/slots-service.js";
import { runConventional } from "./scenarios/conventional.js";
import { fixedClock } from "./scenarios/personal.js";

describe("UC-02 / R25 remembered conventional scheduling service (local reference service)", () => {
  it("rejects a canary listen error and closes the booking service", async () => {
    const service = vi
      .spyOn(SlotsService.prototype, "listen")
      .mockResolvedValue("http://127.0.0.1:1");
    const close = vi.spyOn(SlotsService.prototype, "close").mockResolvedValue();
    const error = Object.assign(new Error("canary port unavailable"), { code: "EADDRINUSE" });
    const canary = vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server) {
      // Keep the simulated server error observable as a pending startup before the fix.
      this.on("error", () => {});
      queueMicrotask(() => this.emit("error", error));
      return this;
    });
    try {
      const started = runConventional(fixedClock("2026-10-19T08:00:00Z"));
      const nextTurn = new Promise<void>((resolve) => setImmediate(resolve));
      await expect(Promise.race([started, nextTurn])).rejects.toBe(error);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      canary.mockRestore();
      close.mockRestore();
      service.mockRestore();
    }
  });

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
