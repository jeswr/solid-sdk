// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { type AutologinInputs, planAutologin } from "./autologin-plan";
import { webIdsEqual } from "./webid-token-provider";

const ALICE = "https://alice.example/profile/card#me";
const BOB = "https://bob.example/profile/card#me";

/** A baseline of inputs where every guard passes and there is no pending/fragment. */
function base(overrides: Partial<AutologinInputs> = {}): AutologinInputs {
  return {
    ready: true,
    hasProvider: true,
    loggedIn: false,
    effectAlreadyRan: false,
    hasPendingRedirect: false,
    pendingRedirectWebId: null,
    hasCodeParams: false,
    hasErrorParams: false,
    fragmentWebId: null,
    sentinel: null,
    webIdsEqual,
    ...overrides,
  };
}

describe("planAutologin — guards", () => {
  it("does nothing until the runtime is ready", () => {
    expect(planAutologin(base({ ready: false, fragmentWebId: ALICE }))).toEqual({ kind: "none" });
  });

  it("does nothing without a provider", () => {
    expect(planAutologin(base({ hasProvider: false, fragmentWebId: ALICE }))).toEqual({
      kind: "none",
    });
  });

  it("does nothing once already logged in — an active session WINS over autologin", () => {
    // Defends the invariant that a deep-link can never override an established
    // (or restored) session: loggedIn short-circuits to `none`.
    expect(
      planAutologin(base({ loggedIn: true, fragmentWebId: ALICE, hasPendingRedirect: true, hasCodeParams: true })),
    ).toEqual({ kind: "none" });
  });

  it("does nothing if the once-guard already fired this page load", () => {
    expect(planAutologin(base({ effectAlreadyRan: true, fragmentWebId: ALICE }))).toEqual({
      kind: "none",
    });
  });

  it("does nothing on a plain page load with no fragment / no redirect return", () => {
    expect(planAutologin(base())).toEqual({ kind: "none" });
  });
});

describe("planAutologin — CASE A (complete) + ABORT", () => {
  it("completes when a pending record + ?code&state are present, carrying the persisted WebID", () => {
    expect(
      planAutologin(
        base({ hasPendingRedirect: true, pendingRedirectWebId: ALICE, hasCodeParams: true }),
      ),
    ).toEqual({ kind: "complete", webId: ALICE });
  });

  it("completes with a null target when the record omitted the WebID (effect falls back to OP claim)", () => {
    expect(
      planAutologin(base({ hasPendingRedirect: true, pendingRedirectWebId: null, hasCodeParams: true })),
    ).toEqual({ kind: "complete", webId: null });
  });

  it("ABORTS (does not ignore) a redirect return carrying an OAuth ?error&state", () => {
    // Without this branch the error return is silently ignored (CASE A needs a code),
    // leaking the pending record + DPoP key + sentinel and blocking future autologins.
    expect(
      planAutologin(base({ hasPendingRedirect: true, hasErrorParams: true })),
    ).toEqual({ kind: "abort-redirect" });
  });

  it("prefers complete over abort when BOTH code and error are present (success wins)", () => {
    expect(
      planAutologin(
        base({
          hasPendingRedirect: true,
          pendingRedirectWebId: ALICE,
          hasCodeParams: true,
          hasErrorParams: true,
        }),
      ),
    ).toEqual({ kind: "complete", webId: ALICE });
  });

  it("does nothing for a pending record with NEITHER code nor error (mid-flight, no return yet)", () => {
    expect(planAutologin(base({ hasPendingRedirect: true }))).toEqual({ kind: "none" });
  });
});

describe("planAutologin — CASE B (begin) + LOOP GUARD", () => {
  it("begins a fresh redirect for a deep-link with no pending record and no sentinel", () => {
    expect(planAutologin(base({ fragmentWebId: ALICE }))).toEqual({ kind: "begin", webId: ALICE });
  });

  it("does NOT begin while a redirect is mid-flight (a pending record exists)", () => {
    // A fragment AND a pending record is not a fresh begin — the pending record path
    // (code/error) owns the return; a fragment without code/error is `none`.
    expect(planAutologin(base({ fragmentWebId: ALICE, hasPendingRedirect: true }))).toEqual({
      kind: "none",
    });
  });

  it("clears the sentinel (does NOT loop) on a repeat deep-link for the SAME WebID", () => {
    expect(planAutologin(base({ fragmentWebId: ALICE, sentinel: ALICE }))).toEqual({
      kind: "clear-sentinel",
    });
  });

  it("begins (not a loop) for a DIFFERENT WebID even when a stale sentinel is set", () => {
    expect(planAutologin(base({ fragmentWebId: BOB, sentinel: ALICE }))).toEqual({
      kind: "begin",
      webId: BOB,
    });
  });

  it("treats a trailing-slash-normalised same WebID as a loop (uses the injected equality)", () => {
    // webIdsEqual normalises scheme/host case + default ports but NOT path — these
    // differ only by host case, so they ARE equal and the loop guard fires.
    expect(
      planAutologin(base({ fragmentWebId: ALICE, sentinel: "https://ALICE.example/profile/card#me" })),
    ).toEqual({ kind: "clear-sentinel" });
  });
});
