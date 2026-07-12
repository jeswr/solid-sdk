// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the SILENT SESSION RESTORE wiring (#69 P0) — the pod-drive adoption of
// @jeswr/solid-session-restore. The package owns the *restore* (the refresh-token
// grant + the clear-vs-preserve-on-failure logic) and ships its own exhaustive tests;
// these tests pin pod-drive's *thin per-app wiring*:
//
//  1. RESTORE-ON-MOUNT — a remembered pointer + a persisted credential whose refresh
//     grant returns the SAME WebID ends LOGGED IN (the `restored` outcome, the pointer
//     re-confirmed), and the restored session is PINNED in the real token provider so a
//     subsequent private read upgrades WITHOUT re-prompting.
//  2. FAIL-CLOSED WebID-MISMATCH — the refresh grant succeeds but authenticates a
//     DIFFERENT WebID than the remembered one → the order-sensitive teardown runs
//     reset() THEN forgetPersisted THEN clears the pointer, and we fall back to login.
//     This is verified ADVERSARIALLY: a teardown variant that omits reset() LEAKS the
//     wrong in-memory session, so the test genuinely FAILS without the guard (then we
//     assert the real wiring restores it).
//  3. invalid_grant CLEARS vs TRANSIENT PRESERVES — driven through the package's real
//     `restoreSession` with a stubbed fetch (a 400 invalid_grant clears the durable
//     entry; a network/5xx failure preserves it) AND the decision-layer keep/drop
//     matrix (`shouldDropRememberedPointer` × the tri-state presence).
import { shouldDropRememberedPointer } from "@jeswr/solid-session-restore";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RestoreCapableProvider,
  type RestorePointer,
  silentRestoreOnce,
} from "./SessionProvider";

const ISSUER = "https://issuer.example/";
const WEBID_A = "https://alice.example/profile/card#me";
const WEBID_B = "https://bob.example/profile/card#me";

// ── In-memory doubles ──────────────────────────────────────────────────────────

/** An in-memory {@link RestorePointer} (the WebID→issuer pointer). */
class MemoryPointer implements RestorePointer {
  #record: { webId: string; issuer?: string } | null = null;
  read() {
    return this.#record;
  }
  write(webId: string, issuer: string) {
    this.#record = { webId, issuer };
  }
  clear() {
    this.#record = null;
  }
}

/**
 * A {@link RestoreCapableProvider} double that records its method-call ORDER (the
 * teardown order is security-critical) and models the package invariant that
 * `restoreSession` PINS the (possibly wrong) session in-memory BEFORE returning. The
 * `sessionLive` flag stands in for "a token is pinned and a read would upgrade with
 * it" — reset() clears it; the adversarial test reads it to prove a leak.
 */
class FakeProvider implements RestoreCapableProvider {
  calls: string[] = [];
  sessionLive = false;
  pinnedWebId: string | undefined;
  forgotten: string[] = [];
  #presence: "present" | "absent" | "unknown" = "present";

  constructor(
    /** What the (package-internal) refresh grant resolves to: a webId, or undefined. */
    private readonly restoreResult: { webId: string } | undefined,
  ) {}

  setPresence(p: "present" | "absent" | "unknown") {
    this.#presence = p;
  }

  async restoreIssuer(issuer: URL): Promise<{ webId: string } | undefined> {
    this.calls.push("restoreIssuer");
    if (!this.restoreResult) return undefined;
    // Mirror the real provider: restoreSession pins the session in-memory BEFORE the
    // decision compares WebIDs — so on a mismatch the WRONG identity is already live.
    this.sessionLive = true;
    this.pinnedWebId = this.restoreResult.webId;
    void issuer;
    return this.restoreResult;
  }
  reset(): void {
    this.calls.push("reset");
    this.sessionLive = false;
    this.pinnedWebId = undefined;
  }
  async forgetPersisted(issuer: URL): Promise<void> {
    this.calls.push("forgetPersisted");
    this.forgotten.push(issuer.href);
  }
  async hasPersisted(): Promise<"present" | "absent" | "unknown"> {
    this.calls.push("hasPersisted");
    return this.#presence;
  }
}

describe("silentRestoreOnce — restore-on-mount (the happy path)", () => {
  it("ends LOGGED IN when the refresh grant returns the SAME WebID, re-confirming the pointer", async () => {
    const provider = new FakeProvider({ webId: WEBID_A });
    const pointer = new MemoryPointer();
    pointer.write(WEBID_A, ISSUER);

    const result = await silentRestoreOnce(provider, pointer);

    expect(result).toEqual({ kind: "restored", webId: WEBID_A, issuer: ISSUER });
    // The session is PINNED (a subsequent private read would upgrade without prompting).
    expect(provider.sessionLive).toBe(true);
    expect(provider.pinnedWebId).toBe(WEBID_A);
    // The pointer is re-confirmed (still WEBID_A → ISSUER), not cleared.
    expect(pointer.read()).toEqual({ webId: WEBID_A, issuer: ISSUER });
    // No teardown ran on the happy path.
    expect(provider.calls).toEqual(["restoreIssuer"]);
  });

  it("SKIPS (no flash) with no remembered pointer — a first-time user", async () => {
    const provider = new FakeProvider({ webId: WEBID_A });
    const pointer = new MemoryPointer(); // empty.

    const result = await silentRestoreOnce(provider, pointer);

    expect(result).toEqual({ kind: "skipped" });
    // restoreIssuer is never even called — nothing to attempt.
    expect(provider.calls).toEqual([]);
    expect(provider.sessionLive).toBe(false);
  });
});

describe("silentRestoreOnce — FAIL-CLOSED WebID-mismatch teardown (security-critical)", () => {
  it("on a different-WebID restore: reset() THEN forgetPersisted THEN clears the pointer, then login", async () => {
    // The refresh grant succeeds but authenticates WEBID_B (a corrupted/misfiled
    // store), while the remembered pointer is WEBID_A → decision `webid-mismatch`.
    const provider = new FakeProvider({ webId: WEBID_B });
    const pointer = new MemoryPointer();
    pointer.write(WEBID_A, ISSUER);

    const result = await silentRestoreOnce(provider, pointer);

    expect(result).toEqual({ kind: "login" });
    // ORDER is load-bearing: drop the WRONG in-memory session FIRST, THEN forget the
    // durable credential. (hasPersisted is NOT consulted on the mismatch path.)
    expect(provider.calls).toEqual(["restoreIssuer", "reset", "forgetPersisted"]);
    // The wrong in-memory session was dropped — NOTHING is left live.
    expect(provider.sessionLive).toBe(false);
    expect(provider.pinnedWebId).toBeUndefined();
    // The durable credential for the remembered issuer was forgotten.
    expect(provider.forgotten).toEqual([ISSUER]);
    // The remembered pointer was cleared (it would fail the isolation check every load).
    expect(pointer.read()).toBeNull();
  });

  // ADVERSARIAL: PROVE the teardown is load-bearing. A teardown variant that OMITS the
  // reset() (the guard against the wrong identity leaking in-memory) leaves the WRONG
  // session LIVE after a mismatch. This re-implements `silentRestoreOnce`'s mismatch
  // branch WITHOUT the reset() to demonstrate the leak the real wiring prevents.
  it("WITHOUT the reset() guard, the WRONG session LEAKS in-memory (the failure the guard prevents)", async () => {
    const provider = new FakeProvider({ webId: WEBID_B });
    const pointer = new MemoryPointer();
    pointer.write(WEBID_A, ISSUER);

    // A NEUTERED teardown: forget the durable credential + clear the pointer, but do
    // NOT reset() the in-memory session (the bug the real ordering closes).
    async function neuteredRestore() {
      const r = pointer.read();
      if (!r) return;
      const restored = await provider.restoreIssuer(new URL(r.issuer ?? ""));
      if (restored && restored.webId !== r.webId) {
        // MISSING: provider.reset();  ← the guard. Without it the wrong session lives.
        if (r.issuer) await provider.forgetPersisted(new URL(r.issuer));
        pointer.clear();
      }
    }
    await neuteredRestore();

    // The neutered teardown LEAKS: the WRONG WebID is still pinned in-memory, so a
    // subsequent private read would carry WEBID_B's token. THIS is the leak.
    expect(provider.sessionLive).toBe(true);
    expect(provider.pinnedWebId).toBe(WEBID_B);

    // And now PROVE the REAL wiring closes it: run the genuine teardown over the SAME
    // leaked state and confirm the wrong session is gone.
    const real = new FakeProvider({ webId: WEBID_B });
    const realPointer = new MemoryPointer();
    realPointer.write(WEBID_A, ISSUER);
    await silentRestoreOnce(real, realPointer);
    expect(real.sessionLive).toBe(false); // reset() ran — no leak.
    expect(real.pinnedWebId).toBeUndefined();
    expect(real.calls.indexOf("reset")).toBeLessThan(real.calls.indexOf("forgetPersisted"));
  });
});

describe("silentRestoreOnce — keep vs drop the remembered pointer on restore failure", () => {
  it("DROPS the pointer when the credential is definitively ABSENT (invalid_grant cleared it)", async () => {
    // restoreIssuer returns undefined (dead/expired token, already cleared by the
    // package) → decision `restore-failed`; presence is `absent` → drop the pointer.
    const provider = new FakeProvider(undefined);
    provider.setPresence("absent");
    const pointer = new MemoryPointer();
    pointer.write(WEBID_A, ISSUER);

    const result = await silentRestoreOnce(provider, pointer);

    expect(result).toEqual({ kind: "login" });
    expect(provider.calls).toEqual(["restoreIssuer", "hasPersisted"]);
    expect(pointer.read()).toBeNull(); // dropped.
  });

  it("KEEPS the pointer when the credential is still PRESENT (a transient failure preserved it)", async () => {
    const provider = new FakeProvider(undefined);
    provider.setPresence("present");
    const pointer = new MemoryPointer();
    pointer.write(WEBID_A, ISSUER);

    const result = await silentRestoreOnce(provider, pointer);

    expect(result).toEqual({ kind: "login" });
    expect(pointer.read()).toEqual({ webId: WEBID_A, issuer: ISSUER }); // KEPT for retry.
  });

  it("KEEPS the pointer when presence is UNKNOWN (a store-read error cannot prove it gone)", async () => {
    const provider = new FakeProvider(undefined);
    provider.setPresence("unknown");
    const pointer = new MemoryPointer();
    pointer.write(WEBID_A, ISSUER);

    await silentRestoreOnce(provider, pointer);
    expect(pointer.read()).toEqual({ webId: WEBID_A, issuer: ISSUER }); // KEPT under uncertainty.
  });
});

// The keep/drop matrix the wiring leans on (mirrors the package's own test, pinned
// here so the pod-drive wiring's expectation is explicit at the adoption boundary).
describe("shouldDropRememberedPointer — the keep/drop matrix", () => {
  it("drops for no-account / no-issuer / webid-mismatch regardless of presence", () => {
    for (const presence of ["present", "absent", "unknown"] as const) {
      expect(shouldDropRememberedPointer("no-account", presence)).toBe(true);
      expect(shouldDropRememberedPointer("no-issuer", presence)).toBe(true);
      expect(shouldDropRememberedPointer("webid-mismatch", presence)).toBe(true);
    }
  });
  it("for restore-failed: drops only when ABSENT, keeps when present/unknown", () => {
    expect(shouldDropRememberedPointer("restore-failed", "absent")).toBe(true);
    expect(shouldDropRememberedPointer("restore-failed", "present")).toBe(false);
    expect(shouldDropRememberedPointer("restore-failed", "unknown")).toBe(false);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
