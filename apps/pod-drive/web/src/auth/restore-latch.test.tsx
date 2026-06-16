// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// roborev findings 3 + 4 on the SessionProvider silent-restore lifecycle — now tested
// LOAD-BEARINGLY against the PRODUCTION exports (no local re-implementations). The prior
// round modelled the decisions in local helpers (`latch`/`restoreEffectWithFix`/
// `runInitWithFix`), so reverting the real guards would NOT have failed the tests. Per
// the codebase's established extracted-decider pattern (planAutologin / decideSingleFlight
// / silentRestoreOnce), the decisions are now PURE, EXPORTED production deciders and these
// tests exercise THEM directly. Each guard is adversarially verified: removing it from
// production code makes the corresponding test below FAIL.
//
//  FINDING 3 (silentRestorePromise latch replayed after logout → spurious fail-closed):
//    the module-level latch caches the restore RESULT promise for the page lifetime.
//    After a successful restore, logout() sets webId=null which re-runs the restore mount
//    effect; consulting the cached `{kind:"restored"}` would replay a stale result against
//    the now-logged-out state. The fix has TWO production halves, each tested here:
//      (a) logout() calls `invalidateSilentRestoreLatch()` (nulls the latch) — proven by
//          priming `runSilentRestore`, invalidating, and asserting a FRESH promise is minted.
//      (b) the restore effect's `decideRestoreEffect` returns `"skip-no-pointer"` when the
//          remembered pointer is null NOW — proven by the decider test; with the branch
//          removed it returns "run" and the replay path reopens.
//
//  FINDING 4 (runtime-init failure leaves the app stuck on "Restoring…"): when
//    getAuthRuntime REJECTS, `ready` stays false so the restore effect never runs and
//    never flips restoringSession → false. The fix: the runtime-init .catch applies
//    `decideRuntimeInitFailure()`, which includes `setRestoringFalse: true`. Tested two
//    ways: (1) the decider asserts the flag-clear is part of the decision; (2) an
//    IMPLEMENTATION-LEVEL test mounts <SessionProvider> with a getAuthRuntime that rejects
//    (the dynamic @solid/reactive-authentication import is mocked to throw) and asserts the
//    UI leaves "Restoring…". Removing `setRestoringFalse` (or the effect's use of it) fails
//    both.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideRestoreEffect,
  decideRuntimeInitFailure,
  invalidateSilentRestoreLatch,
  type RestoreCapableProvider,
  type RestoreEffectInputs,
  runSilentRestore,
} from "./SessionProvider";

const WEBID_A = "https://alice.example/profile/card#me";

/** A provider double that always restores the SAME WebID (the happy restore path). */
class FakeProvider implements RestoreCapableProvider {
  async restoreIssuer(): Promise<{ webId: string } | undefined> {
    return { webId: WEBID_A };
  }
  reset(): void {}
  async forgetPersisted(): Promise<void> {}
  async hasPersisted(): Promise<"present" | "absent" | "unknown"> {
    return "present";
  }
}

// ── FINDING 3 (half a) — the latch is genuinely cleared by invalidateSilentRestoreLatch ──
//
// `runSilentRestore` is the EXACT production single-flight latch logout consults; this
// drives it directly. Removing `silentRestorePromise = null` from
// `invalidateSilentRestoreLatch` (or its call from logout) makes the freshness assertion
// fail — the stale promise would be replayed.
describe("FINDING 3 (a) — invalidateSilentRestoreLatch (called by logout) clears the latch", () => {
  it("a fresh promise is minted after invalidation (the stale 'restored' is NOT replayed)", () => {
    const provider = new FakeProvider();
    // Start from a known-clear latch so this test is order-independent.
    invalidateSilentRestoreLatch();

    // Prime the latch: first call mints + caches the restore promise (single-flight).
    const primed = runSilentRestore(provider);
    // A second call WITHOUT invalidation returns the SAME promise (StrictMode single-flight).
    expect(runSilentRestore(provider)).toBe(primed);

    // LOGOUT calls this. With the fix it nulls the latch.
    invalidateSilentRestoreLatch();

    // The next call must mint a FRESH promise — proving the stale one was cleared. If
    // `invalidateSilentRestoreLatch`'s body is removed (no-op), this is still `primed`
    // and the assertion fails (the post-logout replay bug).
    const afterInvalidate = runSilentRestore(provider);
    expect(afterInvalidate).not.toBe(primed);

    invalidateSilentRestoreLatch(); // leave the module clean for other suites.
  });

  it("resolves the primed + the fresh promise to the same skipped/restore shape (no leak)", async () => {
    // Belt-and-braces: invalidation only swaps the latch identity; both promises still
    // resolve to a valid SilentRestoreResult (no rejection / undefined). The pointer is
    // the real localStorage-backed module singleton (empty in jsdom) → "skipped".
    const provider = new FakeProvider();
    invalidateSilentRestoreLatch();
    const first = await runSilentRestore(provider);
    invalidateSilentRestoreLatch();
    const second = await runSilentRestore(provider);
    expect(first).toEqual(second);
    invalidateSilentRestoreLatch();
  });
});

// ── FINDING 3 (half b) — the restore-effect decision bails on a null pointer ──────────
//
// `decideRestoreEffect` is the PURE, exported decider the production mount effect calls.
// The `skip-no-pointer` branch is the load-bearing finding-3 half: without it, the effect
// runs `runSilentRestore` even with no remembered pointer, reopening the latch replay.
describe("FINDING 3 (b) — decideRestoreEffect skips (does NOT run restore) when no pointer", () => {
  function base(overrides: Partial<RestoreEffectInputs> = {}): RestoreEffectInputs {
    return {
      ready: true,
      hasProvider: true,
      loggedIn: false,
      isAutologinUrl: false,
      hasRememberedPointer: true,
      ...overrides,
    };
  }

  it("returns 'skip-no-pointer' (NOT 'run') when the remembered pointer is null", () => {
    // This is the post-logout re-run: pointer cleared, webId set null → effect re-runs.
    // The decider must NOT return "run" (which would consult/await the cached latch).
    const action = decideRestoreEffect(base({ hasRememberedPointer: false }));
    expect(action).toBe("skip-no-pointer");
    expect(action).not.toBe("run");
  });

  it("returns 'run' on a legitimate first load (a returning user with a pointer)", () => {
    expect(decideRestoreEffect(base({ hasRememberedPointer: true }))).toBe("run");
  });

  it("'skip-not-ready' when not ready / no provider (a later pass owns restoringSession)", () => {
    expect(decideRestoreEffect(base({ ready: false }))).toBe("skip-not-ready");
    expect(decideRestoreEffect(base({ hasProvider: false }))).toBe("skip-not-ready");
  });

  it("'skip-logged-in' when already authenticated", () => {
    expect(decideRestoreEffect(base({ loggedIn: true }))).toBe("skip-logged-in");
  });

  it("'skip-autologin-url' on an autologin/redirect-return load (autologin's job)", () => {
    expect(decideRestoreEffect(base({ isAutologinUrl: true }))).toBe("skip-autologin-url");
  });

  it("the no-pointer guard yields to the autologin-url + logged-in guards (ordering)", () => {
    // Ordering invariant: a logged-in / autologin-url load short-circuits BEFORE the
    // pointer check, but with neither of those the missing pointer is what stops a run.
    expect(decideRestoreEffect(base({ isAutologinUrl: true, hasRememberedPointer: false }))).toBe(
      "skip-autologin-url",
    );
    expect(decideRestoreEffect(base({ loggedIn: true, hasRememberedPointer: false }))).toBe(
      "skip-logged-in",
    );
  });
});

// ── FINDING 4 (decision) — the runtime-init failure decision clears restoringSession ──
describe("FINDING 4 (decision) — decideRuntimeInitFailure clears restoringSession", () => {
  it("includes setRestoringFalse so the catch flips off 'Restoring…' (not just the error)", () => {
    const action = decideRuntimeInitFailure();
    expect(action.setRestoringFalse).toBe(true);
    expect(action.setError).toBe(true);
  });
});

// ── FINDING 4 (implementation) — a rejecting runtime init leaves the UI off "Restoring…" ─
//
// The decider is thin, so this IMPLEMENTATION-LEVEL test guards the WIRING: mount the
// real <App> under <SessionProvider> with the @solid/reactive-authentication dynamic
// import forced to REJECT (so getAuthRuntime rejects), and assert the UI does NOT hang on
// "Restoring your session…" — it must surface the login/error path. Removing
// `setRestoringFalse` from the catch (or from decideRuntimeInitFailure) makes this hang
// and the test fails.
//
// We mock @solid/reactive-authentication's ReactiveFetchManager so its dynamic import in
// getAuthRuntime throws on construction → the runtime promise rejects. We seed a
// remembered pointer FIRST so restoringSession initialises TRUE (otherwise it starts
// false and there is nothing to clear — the test must observe the catch doing the work).
vi.mock("@solid/reactive-authentication", () => ({
  ReactiveFetchManager: class {
    constructor() {
      throw new Error("runtime build failed (forced for the finding-4 test)");
    }
    registerGlobally() {}
  },
}));

describe("FINDING 4 (implementation) — runtime-init rejection un-sticks the Restoring UI", () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem("pod-drive:remembered-account");
    invalidateSilentRestoreLatch();
  });

  it("does NOT remain stuck on 'Restoring your session…' when getAuthRuntime rejects", async () => {
    // Seed the remembered-account pointer so restoringSession starts TRUE on mount —
    // matching the only scenario the finding-4 catch fix actually has to recover from.
    localStorage.setItem(
      "pod-drive:remembered-account",
      JSON.stringify({ webId: WEBID_A, issuer: "https://issuer.example/" }),
    );
    // Import lazily AFTER the mock is installed (vi.mock is hoisted, so the dynamic import
    // inside getAuthRuntime resolves to the throwing mock). Compose exactly as main.tsx:
    // ThemeProvider > SessionProvider > App.
    const { ThemeProvider } = await import("@jeswr/app-shell");
    const { App } = await import("../App");
    const { SessionProvider } = await import("./SessionProvider");

    render(
      <ThemeProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ThemeProvider>,
    );

    // It may briefly show "Restoring your session…", but the rejecting runtime init must
    // flip restoringSession off so the login/error UI renders. If `setRestoringFalse` is
    // removed from the catch, the app hangs on the restoring text forever and this fails.
    await waitFor(
      () => {
        expect(screen.queryByText(/Restoring your session/i)).toBeNull();
      },
      { timeout: 4000 },
    );
  });
});
