// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// establish-still-current.test.ts — the generation + WebID fences guarding the PROVISIONAL +
// AUTHORITATIVE proactive-boundary arms, the FIRST identity guard, the profile-read failure path,
// and the UI publish inside `establishSessionFor` (roborev HIGH, back-ported from pod-health
// becddf5). SECURITY-CRITICAL.
//
// THE BUG IT GUARDS: the #123 proactive-fetch rollout left establishSessionFor UNFENCED — it armed
// + published UNCONDITIONALLY after async awaits (readProfile), and even its FIRST identity guard
// + its profile-read FAILURE path could clobber a superseding flow. A logout()/new login() racing
// those awaits advances the provider generation (via reset()) AND clears the boundary (logout) /
// arms its OWN (a new login). Without the fences the resumed establish would re-arm against a
// reset/stale provider behind a logged-out UI, republish a stale webId/session, write a stale
// pointer, or — on the error/first-guard paths — trip the caller's catch into resetting/clearing
// the SUPERSEDING flow's freshly-armed state.
//
// The decisions are extracted as PURE, exported helpers (the same testable-decision pattern as
// single-flight.ts) so each race is asserted WITHOUT a React render / auth runtime. These
// assertions are ADVERSARIAL: each FAILS if the corresponding fence is weakened.
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAutologinSentinelIfMatches,
  establishGenerationSuperseded,
  establishStillCurrent,
  readSessionFenced,
  SUPERSEDED,
  SupersededLoginError,
} from "./SessionProvider";
import { webIdsEqual } from "./webid-token-provider";

/** A minimal in-memory sessionStorage stand-in for the sentinel compare-and-clear test. */
function installSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
  return store;
}
const AUTOLOGIN_SENTINEL_KEY = "autologin-attempted";

beforeEach(() => {
  installSessionStorage();
});

// A minimal DerivedSession stand-in (the helper only passes it through).
const DERIVED = { podRoot: "https://alice.example/" } as never;

describe("roborev HIGH — establishStillCurrent (fences the provisional + authoritative arms + pointer + publish)", () => {
  const GEN = 7;
  const A = "https://alice.example/profile/card#me";
  const B = "https://bob.example/profile/card#me";
  const base = {
    establishGeneration: GEN,
    requestedWebId: A,
    webIdsEqual,
  };

  it("CURRENT — same generation AND same authenticated WebID → arm + publish proceed", () => {
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: A }),
    ).toBe(true);
  });

  it("SUPERSEDED — a racing logout/new-login ADVANCED the generation → fail-closed (no arm/publish)", () => {
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN + 1, currentAuthenticatedWebId: A }),
    ).toBe(false);
  });

  it("SUPERSEDED — identity SWITCHED to a different WebID at the same generation → fail-closed", () => {
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: B }),
    ).toBe(false);
  });

  it("SUPERSEDED — provider was RESET (authenticated WebID cleared by a logout) → fail-closed", () => {
    expect(
      establishStillCurrent({
        ...base,
        currentGeneration: GEN,
        currentAuthenticatedWebId: undefined,
      }),
    ).toBe(false);
  });

  it("NEVER equates two DIFFERENT users at the same generation (the fail-closed WebID guard)", () => {
    expect(
      establishStillCurrent({
        establishGeneration: GEN,
        currentGeneration: GEN,
        requestedWebId: B,
        currentAuthenticatedWebId: A,
        webIdsEqual,
      }),
    ).toBe(false);
  });

  it("LOGIN-A-RESUMES-AFTER-LOGIN-B: A is superseded by B's higher generation → BAIL (no boundary clobber)", () => {
    // login A snapshots GEN, awaits; login B advances to GEN+1, arms ITS OWN boundary + becomes the
    // authenticated identity. When A resumes, establishStillCurrent MUST return false so A aborts
    // WITHOUT (re-)arming/publishing and WITHOUT clearing B's freshly-armed boundary.
    expect(
      establishStillCurrent({
        establishGeneration: GEN,
        currentGeneration: GEN + 1,
        requestedWebId: A,
        currentAuthenticatedWebId: B,
        webIdsEqual,
      }),
    ).toBe(false);
  });

  it("ADVERSARIAL — WITHOUT the generation check, a generation-advance race wrongly looks current", () => {
    const webIdOnly = (i: {
      requestedWebId: string;
      currentAuthenticatedWebId: string | undefined;
    }) => webIdsEqual(i.currentAuthenticatedWebId, i.requestedWebId);
    expect(webIdOnly({ requestedWebId: A, currentAuthenticatedWebId: A })).toBe(true); // the bug
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN + 1, currentAuthenticatedWebId: A }),
    ).toBe(false); // the fence closes it
  });

  it("ADVERSARIAL — WITHOUT the WebID check, an identity switch at the same generation wrongly looks current", () => {
    const generationOnly = (i: { establishGeneration: number; currentGeneration: number }) =>
      i.currentGeneration === i.establishGeneration;
    expect(generationOnly({ establishGeneration: GEN, currentGeneration: GEN })).toBe(true); // the bug
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: B }),
    ).toBe(false); // the fence closes it
  });
});

// ── establishGenerationSuperseded — the FIRST-GUARD supersede-vs-mismatch discriminator (roborev HIGH) ──
//
// `establishSessionFor`'s very first identity guard runs AFTER the owning flow's awaits, so a
// logout/new-login can supersede it before entry — making authenticatedWebId() ≠ id. Throwing
// there (the pre-fix behaviour) would reach the caller's catch → reset() + clear, clobbering the
// SUPERSEDING flow. This GENERATION-ONLY check (the WebID arm of establishStillCurrent is useless
// on that mismatch path) tells "superseded ⇒ bail" from "genuine OP mismatch ⇒ throw".
describe("roborev HIGH — establishGenerationSuperseded (first-guard supersede vs genuine mismatch)", () => {
  it("SAME generation ⇒ NOT superseded (a WebID mismatch here is a genuine OP failure → throw)", () => {
    expect(establishGenerationSuperseded(7, 7)).toBe(false);
  });

  it("ADVANCED generation ⇒ SUPERSEDED (a racing logout/new-login won → silent bail)", () => {
    expect(establishGenerationSuperseded(7, 8)).toBe(true);
    expect(establishGenerationSuperseded(7, 9)).toBe(true);
    expect(establishGenerationSuperseded(7, 6)).toBe(true); // any inequality
  });

  it("UNREADABLE live generation (undefined) ⇒ fail-OPEN to NOT superseded (never swallow a genuine mismatch)", () => {
    expect(establishGenerationSuperseded(7, undefined)).toBe(false);
  });
});

// ── readSessionFenced — the PROFILE-READ failure path fenced against supersession (roborev HIGH) ──
//
// A logout()/new login() can supersede the establish WHILE `readProfile` is pending, and that read
// can then REJECT. An unconditionally-propagated rejection would make the CALLER's catch (doLogin)
// reset() the provider + clear the proactive boundary — clobbering the SUPERSEDING login's state on
// the ERROR path (the bug this fences). readSessionFenced swallows + returns SUPERSEDED when
// superseded, and re-throws only when the failure is still genuinely OURS.
describe("roborev HIGH — readSessionFenced fences the profile-read REJECTION against supersession", () => {
  it("SUCCESS ⇒ returns the derived session", async () => {
    const r = await readSessionFenced({
      readProfile: async () => ({}) as never,
      deriveSession: () => DERIVED,
      stillCurrent: () => true,
    });
    expect(r).toBe(DERIVED);
  });

  it("REJECT while STILL CURRENT ⇒ RE-THROWS (a genuine failure for THIS login)", async () => {
    const boom = new Error("profile fetch 500");
    await expect(
      readSessionFenced({
        readProfile: async () => {
          throw boom;
        },
        deriveSession: () => DERIVED,
        stillCurrent: () => true,
      }),
    ).rejects.toBe(boom);
  });

  it("REJECT while SUPERSEDED ⇒ SWALLOWS + returns SUPERSEDED (caller must NOT reset/clear)", async () => {
    const r = await readSessionFenced({
      readProfile: async () => {
        throw new Error("profile fetch aborted by the racing logout");
      },
      deriveSession: () => DERIVED,
      stillCurrent: () => false,
    });
    expect(r).toBe(SUPERSEDED);
  });

  it("ADVERSARIAL — WITHOUT the superseded swallow, a superseded rejection would PROPAGATE (the bug)", async () => {
    const propagateAlways = async (): Promise<never> => {
      throw new Error("x"); // the pre-fix code path: no superseded check, the error escapes
    };
    await expect(propagateAlways()).rejects.toThrow("x"); // the bug: it propagates
    await expect(
      readSessionFenced({
        readProfile: async () => {
          throw new Error("x");
        },
        deriveSession: () => DERIVED,
        stillCurrent: () => false,
      }),
    ).resolves.toBe(SUPERSEDED); // the fence closes it
  });
});

// ── SupersededLoginError — the branded "cancelled, not failed" signal (roborev) ──
//
// When establishSessionFor returns "superseded", doLogin throws this so login() REJECTS (it was
// not authenticated — honouring the "resolves only when authenticated" contract) WITHOUT running
// the destructive reset()/clearProactiveBoundary (which would clobber the superseding flow). It
// must be reliably DISTINGUISHABLE from a real login error so the catch can branch on it.
describe("roborev — SupersededLoginError is a branded, distinguishable signal", () => {
  it("is an Error, instanceof-matchable, and carries the superseded brand", () => {
    const e = new SupersededLoginError();
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SupersededLoginError);
    expect(e.superseded).toBe(true);
    expect(e.name).toBe("SupersededLoginError");
  });

  it("a PLAIN Error is NOT mistaken for it (the catch's destructive cleanup still runs for real failures)", () => {
    expect(new Error("profile 500") instanceof SupersededLoginError).toBe(false);
  });
});

// ── clearAutologinSentinelIfMatches — the SUPERSEDED-autologin compare-and-clear (roborev Medium) ──
//
// On a SUPERSEDED autologin completion, blindly clearing the one-shot sentinel could wipe a NEWER
// sentinel a superseding autologin wrote (breaking ITS loop guard); NOT clearing it could leave OUR
// stale sentinel so a later same-WebID deep-link's planAutologin treats it as a loop and swallows
// the retry. Compare-and-clear drops it ONLY when it still names our target.
describe("roborev Medium — clearAutologinSentinelIfMatches (superseded-autologin compare-and-clear)", () => {
  const A = "https://alice.example/profile/card#me";
  const B = "https://bob.example/profile/card#me";

  it("CLEARS the sentinel when it still names OUR target (drop our own stale sentinel)", () => {
    const store = installSessionStorage();
    store.set(AUTOLOGIN_SENTINEL_KEY, A);
    clearAutologinSentinelIfMatches(A);
    expect(store.has(AUTOLOGIN_SENTINEL_KEY)).toBe(false);
  });

  it("PRESERVES a NEWER sentinel a superseding autologin wrote (must not break its loop guard)", () => {
    const store = installSessionStorage();
    store.set(AUTOLOGIN_SENTINEL_KEY, B); // a superseding autologin wrote B's sentinel
    clearAutologinSentinelIfMatches(A); // OUR superseded completion was for A
    expect(store.get(AUTOLOGIN_SENTINEL_KEY)).toBe(B); // B's sentinel survives
  });

  it("no sentinel present ⇒ no-op (no throw)", () => {
    const store = installSessionStorage();
    expect(() => clearAutologinSentinelIfMatches(A)).not.toThrow();
    expect(store.has(AUTOLOGIN_SENTINEL_KEY)).toBe(false);
  });

  it("NORMALISATION (roborev Medium) — a host-CASE variant of OUR target STILL matches (webIdsEqual, not ===)", () => {
    // planAutologin compares WebIDs with the app's normalising webIdsEqual (host case-insensitive).
    // A stored sentinel that is a case-variant of our target must STILL be cleared, or it lingers
    // and the next same-WebID deep-link is swallowed as a loop. Strict === would miss it (the bug).
    const store = installSessionStorage();
    const stored: string = "https://Alice.Example/profile/card#me"; // mixed-case host
    const target: string = "https://alice.example/profile/card#me"; // lower-case host (same WebID)
    expect(stored === target).toBe(false); // strict === would NOT match — the bug
    store.set(AUTOLOGIN_SENTINEL_KEY, stored);
    clearAutologinSentinelIfMatches(target);
    expect(store.has(AUTOLOGIN_SENTINEL_KEY)).toBe(false); // webIdsEqual matched + cleared it
  });
});
