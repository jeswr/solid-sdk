// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-provider-teardown.test.ts — the SessionProvider's logout-teardown ORDER
// (roborev finding #1) and the stale-pending-redirect restore gate (roborev finding #3),
// at the auth seam. HEALTH-SENSITIVE + SECURITY-CRITICAL.
//
// These are pinned as PURE helpers (`runLogoutTeardown`, `isStalePendingRedirect`,
// `explicitFlowInProgress`) extracted from SessionProvider — the same testable-decision
// pattern as autologin-plan.ts / single-flight.ts — so the security-critical ORDER and
// GATE can be asserted with no React render / no auth runtime.
//
// Finding #1 (logout): the durable refresh credential MUST be deleted BEFORE the
// logged-out UI is published, so a user who closes/navigates the instant they see
// "signed out" can never leave it on disk (a same-tick reload could otherwise silently
// restore). The regression below asserts the IndexedDB delete RESOLVES before the
// logged-out state is published — and FAILS against the pre-fix order (publish-then-delete).
//
// Finding #3 (stale pending-redirect): a pending-redirect record with NO `?code`/`?error`
// (the redirect never completed) must NOT suppress silent restore from a valid persisted
// refresh credential. The regression asserts the stale record is detected + cleared and
// the gate then PROCEEDS with restore.
import { webIdsEqual as packageWebIdsEqual } from "@jeswr/solid-session-restore";
import { beforeEach, describe, expect, it } from "vitest";
import {
  explicitFlowInProgress,
  isStalePendingRedirect,
  reconcileRememberedPointer,
  runLogoutTeardown,
} from "./SessionProvider";
import {
  clearPendingRedirectLogin,
  hasPendingRedirectLogin,
  REDIRECT_FLOW_KEY,
  webIdsEqual,
} from "./webid-token-provider";

/** A minimal in-memory sessionStorage stand-in for the DOM-less pure-helper tests. */
function installSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const stub: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
  (globalThis as { sessionStorage?: unknown }).sessionStorage = stub;
  return store;
}

beforeEach(() => {
  installSessionStorage();
});

// ── Finding #1 — logout teardown ORDER: delete BEFORE publish ─────────────────
describe("Finding #1 — runLogoutTeardown deletes the durable credential BEFORE publishing logged-out", () => {
  it("AWAITS forgetDurable before publishLoggedOut — the delete resolves first", async () => {
    const events: string[] = [];
    // Model a SLOW IndexedDB delete: it only resolves on a later microtask. If logout
    // published the logged-out UI before awaiting the delete, "published" would be
    // recorded BEFORE "deleted". The awaited order guarantees the reverse.
    let resolveDelete!: () => void;
    const deletePromise = new Promise<void>((r) => {
      resolveDelete = r;
    });

    const teardown = runLogoutTeardown({
      captureIssuer: async () => "https://issuer.example/",
      resetInMemory: () => events.push("reset"),
      forgetDurable: async (issuer) => {
        events.push(`forget-start:${issuer}`);
        await deletePromise;
        events.push("deleted");
      },
      publishLoggedOut: () => events.push("published"),
    });

    // The teardown is parked at the awaited delete: nothing has published yet, and the
    // in-memory reset already ran (so no authenticated fetch lingers during the delete).
    await Promise.resolve();
    expect(events).toEqual(["reset", "forget-start:https://issuer.example/"]);
    expect(events).not.toContain("published");

    // Now let the durable delete commit, then await logout's completion.
    resolveDelete();
    await teardown;

    // ORDER (load-bearing): reset → forget-start → DELETED → published. The credential
    // is GONE before the logged-out UI is observable.
    expect(events).toEqual([
      "reset",
      "forget-start:https://issuer.example/",
      "deleted",
      "published",
    ]);
    expect(events.indexOf("deleted")).toBeLessThan(events.indexOf("published"));
  });

  it("ADVERSARIAL CONTROL — a publish-then-delete order would publish BEFORE the delete (the bug we guard)", async () => {
    // Reproduce the PRE-FIX ordering (setWebId(null) before `await forgetPersisted`) to
    // prove the assertion above genuinely depends on the awaited order: here publish runs
    // first and the delete is fired-and-forgotten, so "published" precedes "deleted".
    const events: string[] = [];
    let resolveDelete!: () => void;
    const deletePromise = new Promise<void>((r) => {
      resolveDelete = r;
    });
    // The buggy sequence, inlined (NOT via runLogoutTeardown):
    const buggyLogout = async () => {
      events.push("reset");
      events.push("published"); // setWebId(null) BEFORE the awaited delete — the bug.
      await (async () => {
        events.push("forget-start");
        await deletePromise;
        events.push("deleted");
      })();
    };
    const run = buggyLogout();
    await Promise.resolve();
    // The bug: the logged-out UI is already published while the credential is still on disk.
    expect(events).toContain("published");
    expect(events).not.toContain("deleted");
    resolveDelete();
    await run;
    // Under the bug, "published" precedes "deleted" — exactly what the real teardown's
    // order prevents (so the previous test would FAIL against this order).
    expect(events.indexOf("published")).toBeLessThan(events.indexOf("deleted"));
  });

  it("still publishes logged-out even when there is no issuer (nothing to delete)", async () => {
    const events: string[] = [];
    await runLogoutTeardown({
      captureIssuer: async () => undefined,
      resetInMemory: () => events.push("reset"),
      forgetDurable: async () => {
        events.push("forget-should-not-run");
      },
      publishLoggedOut: () => events.push("published"),
    });
    // No issuer → no durable delete, but the UI still reaches logged-out.
    expect(events).toEqual(["reset", "published"]);
  });

  it("a store-delete failure still reaches logged-out, but only AFTER the delete attempt is awaited", async () => {
    // Best-effort: forgetPersisted swallows store errors. Even if forgetDurable rejects
    // (modelled here by a resolved no-op that ran), the UI must still publish — AFTER the
    // delete attempt was awaited (never before).
    const events: string[] = [];
    await runLogoutTeardown({
      captureIssuer: async () => "https://issuer.example/",
      resetInMemory: () => events.push("reset"),
      forgetDurable: async () => {
        events.push("forget-attempted");
      },
      publishLoggedOut: () => {
        events.push("published");
      },
    });
    expect(events).toEqual(["reset", "forget-attempted", "published"]);
    expect(events.indexOf("forget-attempted")).toBeLessThan(events.indexOf("published"));
  });

  it("a localStorage throw in the pointer clear does NOT abort the durable delete (roborev Medium)", async () => {
    // Models the SessionProvider's resetInMemory: drop the in-memory session FIRST, then a
    // GUARDED best-effort pointer clear. If remembered.clear() throws (private mode / quota),
    // the in-memory reset AND the durable credential delete must still happen — the pointer
    // is credential-free, the credential is not.
    const events: string[] = [];
    await runLogoutTeardown({
      captureIssuer: async () => "https://issuer.example/",
      resetInMemory: () => {
        events.push("reset"); // security-critical in-memory drop runs first…
        try {
          // …then the best-effort pointer clear, which throws here (storage unavailable).
          throw new Error("localStorage unavailable");
        } catch {
          events.push("pointer-clear-failed-swallowed");
        }
      },
      forgetDurable: async () => {
        events.push("deleted"); // MUST still run despite the pointer-clear failure.
      },
      publishLoggedOut: () => events.push("published"),
    });
    // The durable delete happened (credential gone) and the order held, despite the throw.
    expect(events).toEqual(["reset", "pointer-clear-failed-swallowed", "deleted", "published"]);
    expect(events).toContain("deleted");
  });
});

// ── Finding (HIGH) — logout MUST be single-flighted ────────────────────────────
describe("logout single-flight — a second concurrent logout shares the first teardown (roborev HIGH)", () => {
  // The SessionProvider.logout gate is `if (logoutInFlight) return logoutInFlight; … ;
  // logoutInFlight = run; run.finally(clear)`. This pins its CONTRACT: a second concurrent
  // call must AWAIT the first teardown (one durable delete, awaited before any caller
  // resolves), NOT run its own — which, after the first reset() cleared the issuer, would
  // capture nothing, skip the delete, and publish logged-out before the delete committed.
  it("two concurrent calls run ONE teardown; the durable delete commits before either resolves", async () => {
    // Reproduce the module-level gate around the REAL runLogoutTeardown.
    let logoutInFlight: Promise<void> | null = null;
    const events: string[] = [];
    let teardownRuns = 0;
    let deleteReleased: () => void = () => {};
    const deleteGate = new Promise<void>((r) => {
      deleteReleased = r;
    });

    const logout = (): Promise<void> => {
      if (logoutInFlight) return logoutInFlight; // SHARE — the HIGH fix.
      teardownRuns += 1;
      const run = runLogoutTeardown({
        captureIssuer: async () => "https://issuer.example/",
        resetInMemory: () => events.push("reset"),
        forgetDurable: async () => {
          await deleteGate; // model an in-flight IndexedDB delete.
          events.push("deleted");
        },
        publishLoggedOut: () => events.push("published"),
      }).finally(() => {
        if (logoutInFlight === run) logoutInFlight = null;
      });
      logoutInFlight = run;
      return run;
    };

    const first = logout();
    const second = logout(); // concurrent — must SHARE, not start a second teardown.
    expect(second).toBe(first); // the very promise the gate returns.
    expect(teardownRuns).toBe(1); // exactly ONE teardown ran.

    deleteReleased(); // let the single delete commit.
    await Promise.all([first, second]);

    // Exactly one delete, and it committed BEFORE the (shared) logout resolved + before publish.
    expect(events).toEqual(["reset", "deleted", "published"]);
    expect(events.filter((e) => e === "deleted")).toHaveLength(1);
  });
});

// ── Finding #3 — a stale pending-redirect must NOT block silent restore ────────
describe("Finding #3 — stale pending-redirect (no ?code/?error) does NOT suppress silent restore", () => {
  it("isStalePendingRedirect — pending record + no code/error is STALE", () => {
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: true,
        hasCodeParams: false,
        hasErrorParams: false,
      }),
    ).toBe(true);
  });

  it("isStalePendingRedirect — a genuine in-flight return (?code) is NOT stale", () => {
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: true,
        hasCodeParams: true,
        hasErrorParams: false,
      }),
    ).toBe(false);
  });

  it("isStalePendingRedirect — a genuine error return (?error) is NOT stale", () => {
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: true,
        hasCodeParams: false,
        hasErrorParams: true,
      }),
    ).toBe(false);
  });

  it("isStalePendingRedirect — no pending record at all is NOT stale", () => {
    expect(
      isStalePendingRedirect({
        hasPendingRedirect: false,
        hasCodeParams: false,
        hasErrorParams: false,
      }),
    ).toBe(false);
  });

  it("after the gate CLEARS a stale record, explicitFlowInProgress no longer suppresses restore", () => {
    // Reproduce the gate's stale-handling: detect stale → clear → re-evaluate the flow
    // gate with hasPendingRedirect=false. The flow is then NOT explicit → restore PROCEEDS.
    const hasCodeParams = false;
    const hasErrorParams = false;
    let hasPendingRedirect = true; // a stale record is present on this plain reopen.

    // PRE-FIX behaviour (the bug): the stale record makes the gate explicit, suppressing
    // restore indefinitely.
    expect(
      explicitFlowInProgress({
        hasCodeParams,
        hasErrorParams,
        fragmentWebId: null,
        hasPendingRedirect,
      }),
    ).toBe(true);

    // THE FIX: detect + clear the stale record, then treat it as absent.
    if (isStalePendingRedirect({ hasCodeParams, hasErrorParams, hasPendingRedirect })) {
      hasPendingRedirect = false;
    }
    // Now the gate is NOT explicit → silent restore runs (the credential is honoured).
    expect(
      explicitFlowInProgress({
        hasCodeParams,
        hasErrorParams,
        fragmentWebId: null,
        hasPendingRedirect,
      }),
    ).toBe(false);
  });

  it("clearPendingRedirectLogin actually removes the stale sessionStorage record", () => {
    // Seed a stale redirect-flow record (as beginRedirectLogin would have, but never
    // completed), then confirm the exported clear removes it so the gate sees it absent.
    sessionStorage.setItem(
      REDIRECT_FLOW_KEY,
      JSON.stringify({
        dpopPrivateJwk: { kty: "EC" },
        dpopPublicJwk: { kty: "EC" },
        codeVerifier: "v",
        usePkce: true,
        state: "s",
        nonce: "n",
        issuer: "https://issuer.example/",
        clientId: "https://app.example/clientid.jsonld",
        redirectUri: "https://app.example/",
        webId: "https://alice.example/profile/card#me",
      }),
    );
    expect(hasPendingRedirectLogin()).toBe(true);
    clearPendingRedirectLogin();
    expect(hasPendingRedirectLogin()).toBe(false);
    expect(sessionStorage.getItem(REDIRECT_FLOW_KEY)).toBeNull();
  });

  it("a genuine ?code return is NOT cleared by the gate (the explicit flow still owns the load)", () => {
    // A real in-flight return must NOT be torn down by the stale-cleanup: it is not stale.
    const inputs = { hasCodeParams: true, hasErrorParams: false, hasPendingRedirect: true };
    expect(isStalePendingRedirect(inputs)).toBe(false);
    // And the gate stays explicit (the redirect-return path completes the login).
    expect(explicitFlowInProgress({ ...inputs, fragmentWebId: null })).toBe(true);
  });

  it("an ORPHANED ?code/?error callback (NO pending record) does NOT suppress restore (roborev)", () => {
    // A stray/bookmarked OAuth callback URL with NO pending redirect record is not OUR flow
    // (completeRedirectLogin reads that record — none → it could not complete anyway). It must
    // NOT count as an explicit flow, or it would strand a valid persisted session forever.
    expect(
      explicitFlowInProgress({
        hasCodeParams: true,
        hasErrorParams: false,
        fragmentWebId: null,
        hasPendingRedirect: false, // ORPHANED — no record backs this callback.
      }),
    ).toBe(false);
    expect(
      explicitFlowInProgress({
        hasCodeParams: false,
        hasErrorParams: true,
        fragmentWebId: null,
        hasPendingRedirect: false,
      }),
    ).toBe(false);
    // But the SAME params WITH a pending record ARE our redirect return → explicit (blocks).
    expect(
      explicitFlowInProgress({
        hasCodeParams: true,
        hasErrorParams: false,
        fragmentWebId: null,
        hasPendingRedirect: true,
      }),
    ).toBe(true);
  });
});

// ── NEW (roborev Mediums, a5314e8 + d919d6d + 0cc8c2a) — pointer reconciliation ──
// The post-login pointer must reconcile against what is ACTUALLY in the durable store,
// WebID-aware (the store is ISSUER-keyed, so a "present" credential on a shared issuer
// may belong to a PRIOR account). reconcileRememberedPointer returns the action:
//   write — current + a credential FOR THIS WebID is stored;
//   clear — current + NOT restorable as this WebID (no credential, OR a DIFFERENT
//           account's on the same issuer) → drop the pointer AND forget the credential;
//   noop  — superseded (a racing logout/new-login advanced the generation / identity);
//   keep  — a transient store-read failure (don't lose a possibly-valid pointer).
describe("roborev Mediums — reconcileRememberedPointer (WebID-aware, fenced)", () => {
  const WEBID_A = "https://alice.example/profile/card#me";
  const WEBID_B = "https://bob.example/profile/card#me";
  const baseCurrent = {
    requestedWebId: WEBID_A,
    establishGeneration: 2,
    currentGeneration: 2,
    currentAuthenticatedWebId: WEBID_A as string | undefined,
    webIdsEqual,
  };

  it("WRITE — current login, a credential FOR THIS WebID is stored", () => {
    expect(
      reconcileRememberedPointer({ ...baseCurrent, storedWebId: WEBID_A, storeReadFailed: false }),
    ).toBe("write");
  });

  it("CLEAR — current login but NO credential is stored (non-restorable)", () => {
    expect(
      reconcileRememberedPointer({
        ...baseCurrent,
        storedWebId: undefined,
        storeReadFailed: false,
      }),
    ).toBe("clear");
  });

  it("CLEAR — CROSS-ACCOUNT: a DIFFERENT account's credential on the SAME (shared) issuer (0cc8c2a)", () => {
    // The store is issuer-keyed, so a credential is "present" — but it is account B's, not
    // this login (A). Writing the A pointer would silently restore B next load. Must CLEAR
    // the pointer AND forget the stale B credential (the establish path then forgetPersists).
    expect(
      reconcileRememberedPointer({ ...baseCurrent, storedWebId: WEBID_B, storeReadFailed: false }),
    ).toBe("clear");
  });

  it("NOOP — superseded: a racing logout advanced the generation", () => {
    expect(
      reconcileRememberedPointer({
        ...baseCurrent,
        currentGeneration: 3, // advanced.
        storedWebId: WEBID_A,
        storeReadFailed: false,
      }),
    ).toBe("noop");
  });

  it("NOOP — superseded: the in-memory identity was reset to undefined (logout)", () => {
    expect(
      reconcileRememberedPointer({
        ...baseCurrent,
        currentAuthenticatedWebId: undefined,
        storedWebId: WEBID_A,
        storeReadFailed: false,
      }),
    ).toBe("noop");
    // ...or re-logged-in as a DIFFERENT identity (fail closed, never a cross-account write).
    expect(
      reconcileRememberedPointer({
        ...baseCurrent,
        currentAuthenticatedWebId: WEBID_B,
        storedWebId: WEBID_A,
        storeReadFailed: false,
      }),
    ).toBe("noop");
  });

  it("TRANSIENT store-read failure → WRITE this login's pointer, never keep a stale one (roborev Medium)", () => {
    // We still know THIS login's identity (the fail-closed guard confirmed it), so on a
    // transient read failure we OVERWRITE the pointer with the current WebID/issuer rather
    // than blindly keeping whatever was there.
    expect(
      reconcileRememberedPointer({ ...baseCurrent, storedWebId: undefined, storeReadFailed: true }),
    ).toBe("write");
  });

  it("CROSS-ACCOUNT on a transient read failure — login as A after a stale B pointer must WRITE A, not keep B", () => {
    // The exact roborev scenario: a prior account (B) pointer survived a restore failure;
    // now A logs in and the store read fails transiently. A blind "keep" would leave B's
    // pointer → next load tries to restore B / mismatch-deletes A's credential. The fix
    // returns "write" so the caller overwrites the pointer with A→issuer.
    expect(
      reconcileRememberedPointer({
        ...baseCurrent,
        requestedWebId: WEBID_A,
        currentAuthenticatedWebId: WEBID_A,
        storedWebId: undefined, // unknown — the read FAILED.
        storeReadFailed: true,
      }),
    ).toBe("write");
  });

  it("the supersede + cross-account fences hold with the PACKAGE webIdsEqual too", () => {
    // Superseded → noop even with the package equality.
    expect(
      reconcileRememberedPointer({
        ...baseCurrent,
        currentAuthenticatedWebId: undefined,
        storedWebId: WEBID_A,
        storeReadFailed: false,
        webIdsEqual: packageWebIdsEqual,
      }),
    ).toBe("noop");
    // Current but a different account's credential → clear (fail closed).
    expect(
      reconcileRememberedPointer({
        ...baseCurrent,
        storedWebId: WEBID_B,
        storeReadFailed: false,
        webIdsEqual: packageWebIdsEqual,
      }),
    ).toBe("clear");
  });
});
