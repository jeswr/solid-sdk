// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Security-critical tests for SILENT SESSION RESTORE — the decision + teardown half.
//
// This pins the THIN per-app wiring (`decideAndApplyRestore` in SessionProvider) on
// top of `@jeswr/solid-session-restore`'s pure `decideSilentRestore`:
//   1. RESTORE-ON-MOUNT: a remembered account + a valid persisted credential →
//      `decideSilentRestore` returns `{outcome:"restored", webId, issuer}`, the
//      provider's `restoreIssuer` is invoked, and the app session is derived + the
//      pointer re-confirmed.
//   2. FAIL-CLOSED WebID-MISMATCH: the refresh grant authenticates a DIFFERENT WebID
//      than the remembered one → decision is `{outcome:"login", reason:"webid-
//      mismatch"}`, and the teardown runs IN ORDER: reset() → forgetPersisted →
//      clear(). The adversarial sub-test PROVES the guard is load-bearing: with
//      `webIdsEqual` neutered to always-true the decision flips to `restored` and the
//      teardown does NOT run — so the assertion genuinely fails without the guard.
//   3. KEEP vs DROP the pointer on a non-mismatch login outcome, driven by the PURE
//      `shouldDropRememberedPointer` + the tri-state credential presence.
//
// No browser, no network: the provider is a hand double + an in-memory store, and the
// (cosmetic) profile read is stubbed so a `restored` outcome derives a session.

import {
  decideSilentRestore,
  type RememberedAccountRecord,
  shouldDropRememberedPointer,
} from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideAndApplyRestore } from "./SessionProvider";
import { webIdsEqual } from "./webid-token-provider";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";
const ISSUER = "https://issuer.example/";

// The (cosmetic) profile read on a `restored` outcome — stubbed so the session can be
// derived without a network/RDF stack. A `restored` token means logged-in even if
// this degrades, but a happy-path read keeps the test focused on the decision.
vi.mock("./profile", () => ({
  readProfile: vi.fn(async (webId: string) => ({
    webId,
    name: webId,
    storages: ["https://alice.example/"],
    oidcIssuers: [ISSUER],
  })),
}));

/** A scripted, order-recording RememberedAccount double. */
function fakeRemembered(initial: RememberedAccountRecord | null) {
  const order: string[] = [];
  let record = initial;
  return {
    order,
    get current() {
      return record;
    },
    read: () => record,
    write: vi.fn((webId: string, issuer: string) => {
      order.push("write");
      record = { webId, issuer };
    }),
    clear: vi.fn(() => {
      order.push("clear");
      record = null;
    }),
  };
}

/** A provider double recording the teardown call order + the restoreIssuer behaviour. */
function fakeProvider(opts: {
  // What the (delegated) refresh grant resolves the restoreIssuer wrapper to.
  restoreResult: { webId: string } | undefined;
  // The tri-state presence hasPersisted reports (defaults present).
  presence?: "present" | "absent" | "unknown";
}) {
  const order: string[] = [];
  return {
    order,
    restoreIssuer: vi.fn(async (_issuer: URL) => {
      order.push("restoreIssuer");
      return opts.restoreResult;
    }),
    reset: vi.fn(() => {
      order.push("reset");
    }),
    forgetPersisted: vi.fn(async (_issuer: URL) => {
      order.push("forgetPersisted");
    }),
    hasPersisted: vi.fn(async (_issuer: URL) => opts.presence ?? "present"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decideSilentRestore — the pure decision (app webIdsEqual)", () => {
  it("restores when the grant authenticates the SAME remembered WebID", async () => {
    const decision = await decideSilentRestore({
      lastActiveWebId: ALICE,
      remembered: [{ webId: ALICE, issuer: ISSUER }],
      restoreIssuer: async () => ({ webId: ALICE }),
      webIdsEqual,
    });
    expect(decision).toEqual({ outcome: "restored", webId: ALICE, issuer: ISSUER });
  });

  it("FAILS CLOSED with webid-mismatch when the grant authenticates a DIFFERENT WebID", async () => {
    const decision = await decideSilentRestore({
      lastActiveWebId: ALICE,
      remembered: [{ webId: ALICE, issuer: ISSUER }],
      // The refresh grant succeeded — but as BOB, not the remembered ALICE.
      restoreIssuer: async () => ({ webId: BOB }),
      webIdsEqual,
    });
    expect(decision).toEqual({ outcome: "login", reason: "webid-mismatch" });
  });

  it("ADVERSARIAL: a NEUTERED webIdsEqual lets a mismatch pass as restored (guard is load-bearing)", async () => {
    // This is the negative control for the WebID-binding guard: if the equality the
    // decision uses always returns true, BOB's grant against ALICE's pointer is
    // (wrongly) accepted as a restore. The real `webIdsEqual` (above) returns
    // webid-mismatch instead — that contrast is exactly the security property.
    const neutered = () => true;
    const decision = await decideSilentRestore({
      lastActiveWebId: ALICE,
      remembered: [{ webId: ALICE, issuer: ISSUER }],
      restoreIssuer: async () => ({ webId: BOB }),
      webIdsEqual: neutered,
    });
    expect(decision.outcome).toBe("restored");
  });
});

describe("decideAndApplyRestore — restore on mount", () => {
  it("pins the session via restoreIssuer and re-confirms the pointer", async () => {
    const provider = fakeProvider({ restoreResult: { webId: ALICE } });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });

    const outcome = await decideAndApplyRestore(provider, remembered);

    expect(provider.restoreIssuer).toHaveBeenCalledOnce();
    expect(provider.restoreIssuer.mock.calls[0][0].href).toBe(ISSUER);
    expect(outcome.kind).toBe("restored");
    if (outcome.kind === "restored") {
      expect(outcome.webId).toBe(ALICE);
      // The session was derived from the (stubbed) profile.
      expect(outcome.session.webId).toBe(ALICE);
    }
    // No teardown on a clean restore; the pointer is re-confirmed (write).
    expect(provider.reset).not.toHaveBeenCalled();
    expect(provider.forgetPersisted).not.toHaveBeenCalled();
    expect(remembered.write).toHaveBeenCalledWith(ALICE, ISSUER);
    expect(remembered.clear).not.toHaveBeenCalled();
  });
});

describe("decideAndApplyRestore — fail-closed WebID-mismatch teardown", () => {
  it("tears down in ORDER reset → forgetPersisted → clear, and returns login", async () => {
    // restoreIssuer (one layer down) ALREADY pinned + re-persisted BOB before the
    // last-active-WebID check up here rejects it — so the teardown must wipe all three.
    const provider = fakeProvider({ restoreResult: { webId: BOB } });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });

    const outcome = await decideAndApplyRestore(provider, remembered);

    expect(outcome).toEqual({ kind: "login" });
    // THE security-critical ordering: in-memory session dropped FIRST (so no patched
    // fetch can upgrade as the wrong WebID during the async forget), THEN the durable
    // credential, THEN the pointer.
    expect(provider.order).toEqual(["restoreIssuer", "reset", "forgetPersisted"]);
    expect(remembered.clear).toHaveBeenCalledOnce();
    // forgetPersisted targeted the remembered issuer.
    expect(provider.forgetPersisted.mock.calls[0][0].href).toBe(ISSUER);
  });

  it("ADVERSARIAL: WITHOUT the webIdsEqual guard the teardown does NOT run (test fails)", async () => {
    // Drive the SAME mismatch (BOB's grant against ALICE's pointer) through a private
    // decide function that uses a NEUTERED webIdsEqual — emulating disabling the
    // fail-closed binding guard. With it neutered the decision is `restored`, so the
    // teardown never fires. The assertion below is what a real WebID-mismatch test
    // asserts (reset+forgetPersisted ran); it MUST FAIL in this neutered world, which
    // is the proof the guard is load-bearing (see the report).
    const provider = fakeProvider({ restoreResult: { webId: BOB } });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });

    // Reproduce decideAndApplyRestore's decision step with the guard disabled.
    const decision = await decideSilentRestore({
      lastActiveWebId: ALICE,
      remembered: [{ webId: ALICE, issuer: ISSUER }],
      restoreIssuer: async (issuer) => provider.restoreIssuer(new URL(issuer)),
      webIdsEqual: () => true, // GUARD DISABLED
    });
    // With the guard disabled the mismatch is (wrongly) accepted → NO teardown.
    expect(decision.outcome).toBe("restored");
    expect(provider.reset).not.toHaveBeenCalled();
    expect(provider.forgetPersisted).not.toHaveBeenCalled();
    expect(remembered.clear).not.toHaveBeenCalled();
  });
});

describe("decideAndApplyRestore — keep/drop pointer on a non-mismatch login outcome", () => {
  it("DROPS the pointer when the credential is definitively absent (invalid_grant cleared it)", async () => {
    // restoreIssuer returns undefined (dead token, the package already cleared it),
    // hasPersisted reports "absent" → reason restore-failed + absent ⇒ DROP.
    const provider = fakeProvider({ restoreResult: undefined, presence: "absent" });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });

    const outcome = await decideAndApplyRestore(provider, remembered);

    expect(outcome).toEqual({ kind: "login" });
    expect(shouldDropRememberedPointer("restore-failed", "absent")).toBe(true);
    expect(remembered.clear).toHaveBeenCalledOnce();
    // No teardown of in-memory/durable state — there was nothing to undo.
    expect(provider.reset).not.toHaveBeenCalled();
    expect(provider.forgetPersisted).not.toHaveBeenCalled();
  });

  it("KEEPS the pointer when the credential survived a TRANSIENT failure (present)", async () => {
    // restoreIssuer returns undefined (a transient blip), but the credential is still
    // present → reason restore-failed + present ⇒ KEEP (retry next load).
    const provider = fakeProvider({ restoreResult: undefined, presence: "present" });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });

    const outcome = await decideAndApplyRestore(provider, remembered);

    expect(outcome).toEqual({ kind: "login" });
    expect(shouldDropRememberedPointer("restore-failed", "present")).toBe(false);
    expect(remembered.clear).not.toHaveBeenCalled();
  });

  it("KEEPS the pointer when the store read could not tell (unknown)", async () => {
    const provider = fakeProvider({ restoreResult: undefined, presence: "unknown" });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });

    await decideAndApplyRestore(provider, remembered);

    expect(shouldDropRememberedPointer("restore-failed", "unknown")).toBe(false);
    expect(remembered.clear).not.toHaveBeenCalled();
  });

  it("falls through to login (no grant, no in-memory teardown) when there is no remembered account", async () => {
    const provider = fakeProvider({ restoreResult: undefined });
    const remembered = fakeRemembered(null);

    const outcome = await decideAndApplyRestore(provider, remembered);

    expect(outcome).toEqual({ kind: "login" });
    // No account → reason "no-account": never runs a grant, never touches in-memory
    // session. shouldDropRememberedPointer("no-account", …) is true, so the (already
    // empty) pointer is cleared idempotently.
    expect(provider.restoreIssuer).not.toHaveBeenCalled();
    expect(provider.reset).not.toHaveBeenCalled();
    expect(provider.forgetPersisted).not.toHaveBeenCalled();
    expect(shouldDropRememberedPointer("no-account", "absent")).toBe(true);
    expect(remembered.clear).toHaveBeenCalledOnce();
  });
});

// PROACTIVE FETCH (task #123) — the silent-restore credential-boundary arming. The
// restore path threads an optional `armBoundary` (RestoreBoundaryArmer) into
// decideAndApplyRestore; on a SUCCESSFUL restore it must be called TWICE — first
// PROVISIONAL (WebID + restored issuer, BEFORE the cosmetic profile read so that read
// carries the token) then AUTHORITATIVE (adding the resolved pod root, so the first
// gallery read after restore is pre-authenticated, killing the per-resource 401-dance
// after a silent restore). On a NON-restore outcome (webid-mismatch teardown, or a
// no-credential login) it must NOT be called — a restore that did not establish a live
// session must never arm the patched fetch (fail-closed: no stale boundary).
describe("decideAndApplyRestore — proactive credential boundary arming (#123)", () => {
  it("arms PROVISIONAL then AUTHORITATIVE on a successful restore", async () => {
    const provider = fakeProvider({ restoreResult: { webId: ALICE } });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });
    const armBoundary = vi.fn();

    const outcome = await decideAndApplyRestore(provider, remembered, armBoundary);

    expect(outcome.kind).toBe("restored");
    // Exactly two arms: provisional (no podRoot yet) then authoritative (podRoot known).
    expect(armBoundary).toHaveBeenCalledTimes(2);
    // 1) PROVISIONAL — WebID + restored issuer, BEFORE the profile read → no podRoot.
    expect(armBoundary).toHaveBeenNthCalledWith(1, { webId: ALICE, issuer: ISSUER });
    // 2) AUTHORITATIVE — adds the pod root derived from the (mocked) profile's
    //    storages[0] = https://alice.example/ → asContainer → https://alice.example/.
    expect(armBoundary).toHaveBeenNthCalledWith(2, {
      webId: ALICE,
      issuer: ISSUER,
      podRoot: "https://alice.example/",
    });
    // Ordering: the provisional arm precedes the profile read which precedes the
    // authoritative arm — so the authoritative call carries a podRoot the provisional
    // one cannot have had.
    expect(armBoundary.mock.calls[0][0].podRoot).toBeUndefined();
    expect(armBoundary.mock.calls[1][0].podRoot).toBe("https://alice.example/");
  });

  it("does NOT arm the boundary on a WebID-MISMATCH teardown (fail-closed)", async () => {
    // BOB's grant against ALICE's pointer → webid-mismatch → teardown, NOT a restore.
    const provider = fakeProvider({ restoreResult: { webId: BOB } });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });
    const armBoundary = vi.fn();

    const outcome = await decideAndApplyRestore(provider, remembered, armBoundary);

    expect(outcome).toEqual({ kind: "login" });
    // The boundary must stay empty — a mismatched restore tore the session down, so the
    // patched fetch must authenticate NOTHING (no stale arming for the wrong WebID).
    expect(armBoundary).not.toHaveBeenCalled();
  });

  it("does NOT arm the boundary when there is nothing to restore (login outcome)", async () => {
    // No credential / no grant → login outcome → no live session → no arming.
    const provider = fakeProvider({ restoreResult: undefined, presence: "absent" });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });
    const armBoundary = vi.fn();

    const outcome = await decideAndApplyRestore(provider, remembered, armBoundary);

    expect(outcome).toEqual({ kind: "login" });
    expect(armBoundary).not.toHaveBeenCalled();
  });

  it("CLEARS the boundary fail-closed if arming succeeded but the restore then FAILS", async () => {
    // The fail-OPEN gap (roborev MEDIUM): a restore that ARMS the boundary (provisional +
    // authoritative) and then THROWS before returning `restored` — here `remembered.write`
    // throws — lands in the outer catch and falls back to `login`. Without clearing, the
    // patched global fetch would stay AUTHENTICATED for the restored credential while the
    // app shows logged-out. The clearBoundary callback MUST fire so the boundary is dropped.
    const provider = fakeProvider({ restoreResult: { webId: ALICE } });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });
    // Make the post-arming step (pointer re-confirm) throw, simulating a wiring fault AFTER
    // the boundary was armed.
    remembered.write.mockImplementation(() => {
      throw new Error("simulated storage failure after boundary arming");
    });
    const armBoundary = vi.fn();
    const clearBoundary = vi.fn();

    const outcome = await decideAndApplyRestore(provider, remembered, armBoundary, clearBoundary);

    // Fell back to login (the throw was caught), AND the boundary it had armed was cleared.
    expect(outcome).toEqual({ kind: "login" });
    expect(armBoundary).toHaveBeenCalled(); // it DID arm before the failure
    expect(clearBoundary).toHaveBeenCalledOnce(); // …so it MUST clear, fail-closed
  });

  it("does NOT clear the boundary when nothing was armed (no spurious clear)", async () => {
    // A login outcome (nothing restored) arms nothing, so the catch's armed-guard must keep
    // clearBoundary from firing — proving the clear is scoped to the post-arm failure, not
    // every login outcome.
    const provider = fakeProvider({ restoreResult: undefined, presence: "absent" });
    const remembered = fakeRemembered({ webId: ALICE, issuer: ISSUER });
    const armBoundary = vi.fn();
    const clearBoundary = vi.fn();

    await decideAndApplyRestore(provider, remembered, armBoundary, clearBoundary);

    expect(armBoundary).not.toHaveBeenCalled();
    expect(clearBoundary).not.toHaveBeenCalled();
  });
});
