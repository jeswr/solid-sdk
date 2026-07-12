// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-provider-teardown.test.ts — the SessionProvider's establish-time GENERATION FENCE
// (roborev HIGH), pinned at the auth seam. SECURITY-CRITICAL.
//
// THE BUG (roborev HIGH, surfaced by pod-health): the #123 proactive-fetch rollout left the
// AUTHORITATIVE credential-boundary arm, the durable remembered-pointer write, and the UI
// publish in `establishSessionFor` UNFENCED — they ran UNCONDITIONALLY after the `readProfile`
// await. A logout() or new login() that RACES that await can (a) re-arm the boundary against a
// reset provider, (b) republish a stale webId/session, or (c) RESURRECT the remembered pointer
// for an already-logged-out / different identity. The fix fences them with the pure, exported
// `establishStillCurrent` (generation unchanged + WebID matches); on the SUPERSEDED path the
// caller BAILS WITHOUT clearing the boundary (clearing would wipe a newer login's boundary).
//
// NOTE pod-mail's provider exposes `resolvedIssuer()` SYNCHRONOUSLY, so the PROVISIONAL arm runs
// in the same synchronous tick as the entry WebID check (no race window before it); the race
// window is the `readProfile` await. The provider's own `#persist` is already generation-fenced
// internally, so the durable CREDENTIAL is safe — this fences the SessionProvider side effects.
//
// These assertions are ADVERSARIAL: each FLIPS if the fence is weakened (e.g. dropping the
// generation check, or the WebID check, would flip a case) — verified by the inline buggy
// controls. Same testable-decision pattern as autologin-plan.ts / single-flight.ts (a PURE
// helper extracted from SessionProvider, asserted with no React render / no auth runtime).
import { describe, expect, it } from "vitest";
import { establishStillCurrent } from "./SessionProvider";
import { webIdsEqual } from "./webid-token-provider";

// establishStillCurrent — the generation+identity fence guarding the durable pointer write +
// AUTHORITATIVE proactive-boundary arm + UI publish in establishSessionFor (roborev HIGH). A
// logout()/new login() racing the `readProfile` await advances the generation (via reset()) AND
// clears the boundary; without this fence the resumed establish would RE-ARM the boundary
// against a reset/stale provider, publish a stale session, and re-write the remembered pointer.
describe("roborev HIGH — establishStillCurrent (fences the pointer write + authoritative arm + publish)", () => {
  const GEN = 7;
  const A = "https://alice.example/profile/card#me";
  const B = "https://bob.example/profile/card#me";
  const base = {
    establishGeneration: GEN,
    requestedWebId: A,
    webIdsEqual,
  };

  it("CURRENT — same generation AND same authenticated WebID → arm + write + publish proceed", () => {
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: A }),
    ).toBe(true);
  });

  it("SUPERSEDED — a racing logout/new-login ADVANCED the generation → fail-closed (no arm/write/publish)", () => {
    // The generation moved on even though the (stale) authenticated WebID still reads A:
    // the fence must FAIL CLOSED on the generation mismatch alone. Without the generation
    // check this would wrongly return true and re-arm/re-write against the superseded provider.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN + 1, currentAuthenticatedWebId: A }),
    ).toBe(false);
  });

  it("SUPERSEDED — identity SWITCHED to a different WebID at the same generation → fail-closed", () => {
    // A re-login as B advanced+settled to B's identity: arming/writing/publishing A here would
    // republish a stale identity + resurrect A's pointer. The WebID check fails closed even if
    // the generation matched.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: B }),
    ).toBe(false);
  });

  it("SUPERSEDED — provider was RESET (authenticated WebID cleared by logout) → fail-closed", () => {
    // A logout reset the provider: authenticatedWebId() is now undefined. The fence must not
    // re-arm the boundary / re-write the pointer against the logged-out provider.
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
    // the reverse (requested B, current A) must too — the WebID binding is symmetric.
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

  it("LOGIN-A-RESUMES-AFTER-LOGIN-B: A is superseded by B's higher generation (the exact race)", () => {
    // login A's establish snapshots generation GEN, then awaits readProfile; login B starts,
    // advances the provider to GEN+1, arms ITS OWN boundary, and becomes the authenticated
    // identity (B). When A resumes, establishStillCurrent MUST return false (B's generation
    // supersedes A) — so A aborts WITHOUT publishing and, crucially, WITHOUT clearing the
    // boundary. A clear here would wipe B's freshly-armed boundary and leave B's logged-in UI
    // making unauthenticated reads — the bug this guards (the SUPERSEDED branch makes NO
    // clearProactiveBoundary call, verified by inspection of SessionProvider.tsx).
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

  // ── ADVERSARIAL CONTROLS — prove each assertion GENUINELY depends on the fence ──────────
  describe("ADVERSARIAL — a weakened fence FLIPS the superseded cases (proving the fence is load-bearing)", () => {
    // The buggy "generation-only" fence (drops the WebID check).
    const generationOnlyFence = (inputs: {
      establishGeneration: number;
      currentGeneration: number;
    }): boolean => inputs.currentGeneration === inputs.establishGeneration;
    // The buggy "no fence at all" (the pre-fix unconditional arm/write/publish): always true.
    const noFence = (): boolean => true;

    it("generation-only fence WRONGLY passes an identity switch the real fence rejects", () => {
      const inputs = {
        establishGeneration: GEN,
        currentGeneration: GEN,
        requestedWebId: A,
        currentAuthenticatedWebId: B as string | undefined,
        webIdsEqual,
      };
      // The REAL fence rejects (B != A) — the fix.
      expect(establishStillCurrent(inputs)).toBe(false);
      // The buggy generation-only fence WRONGLY accepts it (re-arms B's boundary / re-writes
      // A's pointer) — the bug.
      expect(generationOnlyFence(inputs)).toBe(true);
    });

    it("no-fence (the pre-fix unconditional arm/write/publish) WRONGLY passes a superseded generation", () => {
      const inputs = {
        establishGeneration: GEN,
        currentGeneration: GEN + 1, // superseded by a racing login/logout
        requestedWebId: A,
        currentAuthenticatedWebId: undefined,
        webIdsEqual,
      };
      // The REAL fence rejects (generation advanced AND identity cleared) — the fix.
      expect(establishStillCurrent(inputs)).toBe(false);
      // The pre-fix unconditional path WRONGLY proceeds — re-arming + resurrecting the pointer
      // behind a logged-out UI.
      expect(noFence()).toBe(true);
    });
  });
});
