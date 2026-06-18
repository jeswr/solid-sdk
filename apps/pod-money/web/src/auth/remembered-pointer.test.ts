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

import { describe, expect, it } from "vitest";
import { rememberedPointerAction } from "./SessionProvider";

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
