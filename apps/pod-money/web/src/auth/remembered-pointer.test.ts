// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Regression test for the CROSS-ACCOUNT STALE-POINTER bug (roborev HIGH): on a
// successful login the remembered-account pointer must be WRITTEN only when a durable
// credential for THIS WebID exists, and CLEARED otherwise — so a stale pointer left by
// a PRIOR account (e.g. Alice, whose restore transiently failed and kept her pointer)
// can never survive a login as a DIFFERENT WebID (Bob) that has no durable credential
// and silently restore the WRONG account on the next reload.
//
// `rememberedPointerAction` is the pure decision the SessionProvider's
// establishSessionFor drives the write/clear off; pinning it here keeps the
// security-critical rule unit-tested without a full React harness.
//
// SessionProvider imports @solid/reactive-authentication only as a TYPE (erased at
// runtime) and loads its runtime via a dynamic import inside an effect, so importing
// the pure helper at module top-level pulls in no browser-only runtime.

import { webIdsEqual } from "@jeswr/solid-session-restore";
import { describe, expect, it } from "vitest";
import { planLoginPointer, rememberedPointerAction } from "./SessionProvider";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const I_A = "https://alice-issuer.example/";
const I_B = "https://bob-issuer.example/";

describe("rememberedPointerAction — cross-account stale-pointer guard", () => {
  it("WRITES the pointer only when a durable credential for THIS WebID is present", () => {
    expect(rememberedPointerAction("present")).toBe("write");
  });

  it("CLEARS any existing pointer when there is no matching durable credential", () => {
    // "absent" — the redirect path / a no-offline-access server: no durable credential
    // for this login, so a prior account's pointer must not linger.
    expect(rememberedPointerAction("absent")).toBe("clear");
    // "unknown" — a store-read error: fail-closed, DROP the pointer rather than risk
    // restoring a wrong account next load.
    expect(rememberedPointerAction("unknown")).toBe("clear");
    // undefined — no provider / no issuer resolved: nothing to promise, clear.
    expect(rememberedPointerAction(undefined)).toBe("clear");
  });
});

describe("planLoginPointer — account-switch durable-credential cleanup", () => {
  it("re-login as the SAME account (credential present): write, forget nothing", () => {
    const plan = planLoginPointer(
      { webId: ALICE, issuer: I_A },
      { webId: ALICE, issuer: I_A },
      "present",
      webIdsEqual,
    );
    expect(plan).toEqual({ pointer: "write" });
  });

  it("login as a DIFFERENT account on a DIFFERENT issuer (no prior credential kept): clear + FORGET the prior", () => {
    // Alice's pointer (issuer I_A) is stale; Bob logs in with no durable credential
    // (e.g. redirect path / no offline_access) → Bob writes no pointer, and Alice's
    // orphaned credential under I_A must be forgotten (not left in IndexedDB forever).
    const plan = planLoginPointer(
      { webId: ALICE, issuer: I_A },
      { webId: BOB, issuer: I_B },
      "absent",
      webIdsEqual,
    );
    expect(plan).toEqual({ pointer: "clear", forgetIssuer: I_A });
  });

  it("login as a DIFFERENT account on the SAME issuer, Bob persists his own: write Bob, FORGET... not Bob's own", () => {
    // Bob persisted a credential under the SHARED issuer (overwriting Alice's slot), so
    // forgetting that issuer would wipe Bob's OWN fresh credential — must NOT happen.
    const plan = planLoginPointer(
      { webId: ALICE, issuer: I_A },
      { webId: BOB, issuer: I_A },
      "present",
      webIdsEqual,
    );
    expect(plan).toEqual({ pointer: "write" }); // write Bob; do NOT forget the shared issuer
  });

  it("login as a DIFFERENT account on a DIFFERENT issuer, Bob persists his own: write Bob + FORGET Alice's issuer", () => {
    const plan = planLoginPointer(
      { webId: ALICE, issuer: I_A },
      { webId: BOB, issuer: I_B },
      "present",
      webIdsEqual,
    );
    expect(plan).toEqual({ pointer: "write", forgetIssuer: I_A });
  });

  it("no prior pointer: just write/clear, nothing to forget", () => {
    expect(planLoginPointer(null, { webId: BOB, issuer: I_B }, "present", webIdsEqual)).toEqual({
      pointer: "write",
    });
    expect(planLoginPointer(null, { webId: BOB, issuer: I_B }, "absent", webIdsEqual)).toEqual({
      pointer: "clear",
    });
  });
});
