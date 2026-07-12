// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// establish-still-current.test.ts — the generation + WebID fence guarding the
// PROVISIONAL and AUTHORITATIVE proactive-boundary arms + the UI publish inside
// `establishSessionFor` (roborev HIGH, back-ported from pod-health becddf5).
// SECURITY-CRITICAL.
//
// THE BUG IT GUARDS: the #123 proactive-fetch rollout left the provisional +
// authoritative credential-boundary arms in `establishSessionFor` UNFENCED — they
// armed + published UNCONDITIONALLY after async awaits (`readProfile`,
// `hasPersistedForWebId`). A logout()/new login() racing those awaits advances the
// provider generation (via reset()) AND clears the boundary (logout) / arms its OWN
// (a new login). Without the fence the resumed establish would re-arm the boundary
// against a reset/stale provider behind a logged-out UI, republish a stale
// webId/session, or clobber a NEWER login's freshly-armed boundary.
//
// `establishStillCurrent` is extracted as a PURE, exported helper (the same
// testable-decision pattern as autologin-plan.ts / single-flight.ts) so the race is
// asserted WITHOUT a React render / auth runtime. These assertions are ADVERSARIAL:
// each FAILS if the fence is weakened (dropping the generation check, or the WebID
// check, flips a case) — see the explicit "without-the-fence" controls below.
import { describe, expect, it, vi } from "vitest";
import {
  applyFencedLoginPointer,
  establishGenerationSuperseded,
  establishStillCurrent,
  readSessionFenced,
  SUPERSEDED,
  SupersededLoginError,
} from "./SessionProvider";
import { webIdsEqual } from "./webid-token-provider";

// A minimal DerivedSession stand-in (the helper only passes it through).
const DERIVED = { podRoot: "https://alice.example/" } as never;

describe("roborev HIGH — establishStillCurrent (fences the provisional + authoritative arms + publish)", () => {
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
    // The generation moved on even though the (stale) authenticated WebID still reads A:
    // the fence must FAIL CLOSED on the generation mismatch alone. Without the generation
    // check this would wrongly return true and re-arm against the superseded provider.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN + 1, currentAuthenticatedWebId: A }),
    ).toBe(false);
  });

  it("SUPERSEDED — identity SWITCHED to a different WebID at the same generation → fail-closed", () => {
    // A re-login as B advanced+settled to B's identity: arming/publishing A here would
    // republish a stale identity. The WebID check fails closed even if the generation matched.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: B }),
    ).toBe(false);
  });

  it("SUPERSEDED — provider was RESET (authenticated WebID cleared by a logout) → fail-closed", () => {
    // A logout reset the provider: authenticatedWebId() is now undefined. The fence must not
    // re-arm the boundary against the logged-out provider nor publish a stale session.
    expect(
      establishStillCurrent({
        ...base,
        currentGeneration: GEN,
        currentAuthenticatedWebId: undefined,
      }),
    ).toBe(false);
  });

  it("NEVER equates two DIFFERENT users at the same generation (the fail-closed WebID guard)", () => {
    // Defence-in-depth: even a same-generation race that swapped A→B must fail closed, and
    // the reverse requested B with current A must too — the WebID binding is symmetric.
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
    // The exact race the finding flags: login A's establish snapshots generation GEN, then
    // awaits; login B starts, advances the provider to GEN+1, arms ITS OWN boundary, and
    // becomes the authenticated identity (B). When A resumes, establishStillCurrent MUST return
    // false (B's generation supersedes A) — so A aborts WITHOUT (re-)arming/publishing and,
    // crucially, WITHOUT clearing the boundary (the superseded branches make NO
    // clearProactiveBoundary call — verified by inspection of SessionProvider.tsx). A clear
    // here would wipe B's freshly-armed boundary and leave B's logged-in UI making
    // unauthenticated reads — the bug this guards.
    expect(
      establishStillCurrent({
        establishGeneration: GEN, // A's snapshot
        currentGeneration: GEN + 1, // B advanced it
        requestedWebId: A, // A's identity
        currentAuthenticatedWebId: B, // but B is now authenticated
        webIdsEqual,
      }),
    ).toBe(false);
  });

  // ── ADVERSARIAL CONTROLS — prove the fence is load-bearing ──────────────────────
  //
  // These assert that a WEAKENED fence (dropping one of the two checks) would FLIP a
  // case to the wrong answer — i.e. the bug really exists and the fence really closes it.

  it("ADVERSARIAL — WITHOUT the generation check, a generation-advance race wrongly looks current", () => {
    // Simulate the pre-fix arm-decision that only checked the WebID (and not the generation).
    // The same inputs as the "ADVANCED the generation" case above: a logout/new-login bumped
    // the generation but the stale authenticatedWebId still reads A. A WebID-only check returns
    // TRUE (would re-arm against the superseded provider) — whereas the real fence returns FALSE.
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
    // Simulate the pre-fix arm-decision that only checked the generation. After a same-tick
    // re-login as B the generation can coincide (or a reset+login lands back on GEN), but the
    // authenticated identity is now B. A generation-only check returns TRUE (would publish A's
    // stale session) — whereas the real fence's WebID binding returns FALSE.
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
    // even a (defensive) BACKWARD move is a mismatch ⇒ superseded (any inequality).
    expect(establishGenerationSuperseded(7, 6)).toBe(true);
  });

  it("UNREADABLE live generation (undefined) ⇒ fail-OPEN to NOT superseded (never swallow a genuine mismatch)", () => {
    // If the live generation can't be read we must NOT silently bail — a genuine OP mismatch must
    // still surface. So undefined ⇒ not superseded (the throw path runs).
    expect(establishGenerationSuperseded(7, undefined)).toBe(false);
  });
});

// ── applyFencedLoginPointer — the EXTRACTED async pointer reconciliation flow (roborev HIGH) ──
//
// The predicate tests above prove establishStillCurrent itself. THESE tests exercise the actual
// fenced SIDE-EFFECT wiring: a logout()/new login() that supersedes the establish DURING the
// awaited `readPresence` must produce NO remembered-pointer write/clear — the bug being fixed
// lives in this async flow, not just the boolean. `stillCurrent` is injected so we can flip it AT
// the await boundary to simulate the race.
//
// NOTE: this flow deliberately does NOT delete the durable credential (roborev HIGH — a
// non-transactional read+delete from a supersedable context is racy). It only reconciles the
// credential-FREE remembered pointer (a synchronous, fence-able localStorage op).
describe("roborev HIGH — applyFencedLoginPointer fences the remembered-pointer SIDE EFFECT", () => {
  const A = "https://alice.example/profile/card#me";
  const ISS_A = "https://alice.example/";

  /** Build the injected side-effect spies + a flippable `stillCurrent`. */
  function harness(opts: {
    presence: "present" | "absent" | "unknown";
    /** Throw from the presence read (the catch-path). */
    presenceThrows?: boolean;
    /** Become superseded AFTER this many `stillCurrent()` calls (0 = superseded from the start). */
    supersedeAfter?: number;
    issuer?: string | undefined;
  }) {
    let checks = 0;
    const writePointer = vi.fn();
    const clearPointer = vi.fn();
    const stillCurrent = vi.fn(() => {
      checks += 1;
      return opts.supersedeAfter === undefined ? true : checks <= opts.supersedeAfter;
    });
    const readPresence = vi.fn(async () => {
      if (opts.presenceThrows) throw new Error("store read failed");
      return opts.presence;
    });
    return {
      run: () =>
        applyFencedLoginPointer({
          thisLogin: { webId: A, issuer: "issuer" in opts ? opts.issuer : ISS_A },
          readPresence,
          writePointer,
          clearPointer,
          stillCurrent,
        }),
      writePointer,
      clearPointer,
    };
  }

  it("HAPPY (current throughout) — present credential ⇒ WRITE the pointer", async () => {
    const h = harness({ presence: "present" });
    const r = await h.run();
    expect(r).toEqual({ pointer: "write", superseded: false });
    expect(h.writePointer).toHaveBeenCalledWith(A, ISS_A);
    expect(h.clearPointer).not.toHaveBeenCalled();
  });

  it("HAPPY — no credential ⇒ CLEAR the pointer (no broken-promise pointer lingers)", async () => {
    const h = harness({ presence: "absent" });
    const r = await h.run();
    expect(r).toEqual({ pointer: "clear", superseded: false });
    expect(h.clearPointer).toHaveBeenCalledTimes(1);
    expect(h.writePointer).not.toHaveBeenCalled();
  });

  it("present credential but NO issuer ⇒ CLEAR (cannot write a pointer with no issuer)", async () => {
    const h = harness({ presence: "present", issuer: undefined });
    const r = await h.run();
    expect(r.pointer).toBe("clear");
    expect(h.writePointer).not.toHaveBeenCalled();
    expect(h.clearPointer).toHaveBeenCalledTimes(1);
  });

  it("SUPERSEDED during readPresence ⇒ NO pointer side effect at all (the HIGH bug)", async () => {
    // The race the finding flags: a logout/new-login wins WHILE `hasPersistedForWebId` awaits.
    // The fence (the stillCurrent() call after the presence await) must return false, so NEITHER
    // write nor clear runs — the superseder owns the pointer.
    const h = harness({ presence: "present", supersedeAfter: 0 });
    const r = await h.run();
    expect(r.superseded).toBe(true);
    expect(r.pointer).toBe("none");
    expect(h.writePointer).not.toHaveBeenCalled();
    expect(h.clearPointer).not.toHaveBeenCalled();
  });

  it("presence-read THROWS but still current ⇒ fail-closed CLEAR", async () => {
    const h = harness({ presence: "present", presenceThrows: true });
    const r = await h.run();
    expect(r).toEqual({ pointer: "clear", superseded: false });
    expect(h.clearPointer).toHaveBeenCalledTimes(1);
  });

  it("presence-read THROWS AND superseded ⇒ NOT even the fail-closed clear (superseder owns it)", async () => {
    // The catch-path clear is itself fenced: if the throw coincided with a supersession, clearing
    // would wipe the NEW login's pointer. So no clear runs.
    const h = harness({ presence: "present", presenceThrows: true, supersedeAfter: 0 });
    const r = await h.run();
    expect(r.superseded).toBe(true);
    expect(h.clearPointer).not.toHaveBeenCalled();
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
        stillCurrent: () => true, // not superseded → the error is ours
      }),
    ).rejects.toBe(boom);
  });

  it("REJECT while SUPERSEDED ⇒ SWALLOWS + returns SUPERSEDED (caller must NOT reset/clear)", async () => {
    // The exact race the finding flags: a logout/new-login won during the profile read, then the
    // read rejected. The helper must NOT propagate (which would trip doLogin's catch → reset +
    // clear, clobbering the superseder). It returns SUPERSEDED so the caller bails, touching nothing.
    const r = await readSessionFenced({
      readProfile: async () => {
        throw new Error("profile fetch aborted by the racing logout");
      },
      deriveSession: () => DERIVED,
      stillCurrent: () => false, // superseded → swallow
    });
    expect(r).toBe(SUPERSEDED);
  });

  it("ADVERSARIAL — WITHOUT the superseded swallow, a superseded rejection would PROPAGATE (the bug)", async () => {
    // Model the pre-fix behaviour (always re-throw, never swallow): a superseded rejection escapes
    // and would reach doLogin's unconditional reset()/clear of the superseding login. The fence
    // converts exactly this case into a silent SUPERSEDED bail.
    const propagateAlways = async (): Promise<never> => {
      throw new Error("x"); // the pre-fix code path: no superseded check, the error escapes
    };
    await expect(propagateAlways()).rejects.toThrow("x"); // the bug: it propagates
    // The real helper instead swallows when superseded:
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

// ── SupersededLoginError — the branded "cancelled, not failed" signal (roborev Medium) ──
//
// When establishSessionFor returns "superseded", doLogin throws this so login() REJECTS (it was
// not authenticated — honouring the "resolves only when authenticated" contract) WITHOUT running
// the destructive reset()/clearProactiveBoundary (which would clobber the superseding flow). It
// must be reliably DISTINGUISHABLE from a real login error so the catch can branch on it.
describe("roborev Medium — SupersededLoginError is a branded, distinguishable signal", () => {
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
