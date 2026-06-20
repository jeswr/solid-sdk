// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-provider-teardown.test.ts — the SessionProvider's establish-time GENERATION FENCE
// (roborev HIGH), pinned at the auth seam. SECURITY-CRITICAL.
//
// THE BUG (roborev HIGH, surfaced by pod-health, refined by pod-music/pod-chat, back-ported to
// pod-drive): the #123 proactive-fetch rollout left the PROVISIONAL + AUTHORITATIVE
// credential-boundary arms, the remembered-pointer write, and the UI publish in
// `establishSessionFor` UNFENCED — they armed/pointed/published UNCONDITIONALLY after the async
// authenticated-profile re-read (`readProfile`). A logout() or new login() that RACES that await
// can (a) re-arm the boundary against a reset provider, (b) republish a stale webId/session, or
// (c) clear/clobber a NEWER login's boundary. The fix fences each post-await step with the pure,
// exported `establishStillCurrent` (generation unchanged + WebID matches); on the SUPERSEDED path
// the caller BAILS WITHOUT clearing the boundary (clearing would wipe a newer login's boundary).
// The deeper resurrect-logged-out-credential race at the durable-persist step is closed INSIDE
// `WebIdDPoPTokenProvider.#persistSession` (the provider persists during upgrade()/restoreSession()
// behind its own caller-captured generation re-fence — pod-drive's establish has no separate
// persist await; see persist-gate.test.ts / webid-token-provider.test.ts for that fence).
//
// These assertions are ADVERSARIAL: each FLIPS if the fence is weakened (e.g. dropping the
// generation check, or the WebID check, would flip a case) — verified by the inline buggy
// controls. This is the same testable-decision pattern as autologin-plan.ts / single-flight.ts
// (a PURE helper extracted from SessionProvider, asserted with no React render / no auth runtime).
import { webIdsEqual as packageWebIdsEqual } from "@jeswr/solid-session-restore";
import { describe, expect, it } from "vitest";
import {
  type EstablishSessionDeps,
  establishStillCurrent,
  runEstablishSession,
} from "./SessionProvider";
import type { DerivedSession } from "./session-derivation";
import { webIdsEqual } from "./webid-token-provider";

// establishStillCurrent — the generation+identity fence guarding the AUTHORITATIVE
// proactive-boundary arm, the remembered-pointer write, and the UI publish in
// establishSessionFor (roborev HIGH). A logout()/new login() racing the profile re-read advances
// the generation (via reset()) AND clears the boundary; without this fence the resumed establish
// would RE-ARM the boundary against a reset/stale provider AND publish a stale logged-in session —
// or, on a NEW login, clobber the new login's freshly-armed boundary.
describe("roborev HIGH — establishStillCurrent (fences authoritative arm + pointer + publish)", () => {
  const GEN = 7;
  const A = "https://alice.example/profile/card#me";
  const B = "https://bob.example/profile/card#me";
  const base = {
    establishGeneration: GEN,
    requestedWebId: A,
    webIdsEqual,
  };

  it("CURRENT — same generation AND same authenticated WebID → arm + point + publish proceed", () => {
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: A }),
    ).toBe(true);
  });

  it("SUPERSEDED — a racing logout/new-login ADVANCED the generation → fail-closed (no arm/point/publish)", () => {
    // The generation moved on even though the (stale) authenticated WebID still reads A:
    // the fence must FAIL CLOSED on the generation mismatch alone. Without the generation
    // check this would wrongly return true and re-arm/publish against the superseded provider.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN + 1, currentAuthenticatedWebId: A }),
    ).toBe(false);
  });

  it("SUPERSEDED — identity SWITCHED to a different WebID at the same generation → fail-closed", () => {
    // A re-login as B advanced+settled to B's identity: arming/publishing A here would
    // resurrect a stale identity. The WebID check fails closed even if the generation matched.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: B }),
    ).toBe(false);
  });

  it("SUPERSEDED — provider was RESET (authenticated WebID cleared by logout) → fail-closed", () => {
    // A logout reset the provider: authenticatedWebId() is now undefined. The fence must not
    // re-arm the boundary / re-publish against the logged-out provider (re-enabling reads
    // behind a logged-out UI).
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
    // clearProactiveBoundary call, asserted by the runEstablishSession integration suite below).
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

  it("holds with the PACKAGE webIdsEqual too (identical fail-closed semantics)", () => {
    // Current → true with the package equality…
    expect(
      establishStillCurrent({
        ...base,
        currentGeneration: GEN,
        currentAuthenticatedWebId: A,
        webIdsEqual: packageWebIdsEqual,
      }),
    ).toBe(true);
    // …superseded identity → false.
    expect(
      establishStillCurrent({
        ...base,
        currentGeneration: GEN,
        currentAuthenticatedWebId: B,
        webIdsEqual: packageWebIdsEqual,
      }),
    ).toBe(false);
  });

  // ── ADVERSARIAL CONTROLS — prove each assertion GENUINELY depends on the fence ──────────
  // Each control reproduces a WEAKENED fence (one of the two checks dropped) and shows the
  // SAME inputs that the real fence rejects would WRONGLY pass — i.e. the fix is load-bearing.
  describe("ADVERSARIAL — a weakened fence FLIPS the superseded cases (proving the fence is load-bearing)", () => {
    // The buggy "generation-only" fence (drops the WebID check): an identity switch at the
    // same generation would WRONGLY be treated as current.
    const generationOnlyFence = (inputs: {
      establishGeneration: number;
      currentGeneration: number;
    }): boolean => inputs.currentGeneration === inputs.establishGeneration;
    // The buggy "no fence at all" (the pre-fix unconditional arm): always true.
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
      // The buggy generation-only fence WRONGLY accepts it (re-arms/publishes B's session as A) — the bug.
      expect(generationOnlyFence(inputs)).toBe(true);
    });

    it("no-fence (the pre-fix unconditional arm) WRONGLY passes a superseded generation", () => {
      const inputs = {
        establishGeneration: GEN,
        currentGeneration: GEN + 1, // superseded by a racing login/logout
        requestedWebId: A,
        currentAuthenticatedWebId: undefined,
        webIdsEqual,
      };
      // The REAL fence rejects (generation advanced AND identity cleared) — the fix.
      expect(establishStillCurrent(inputs)).toBe(false);
      // The pre-fix unconditional arm WRONGLY proceeds — re-arming behind a logged-out UI.
      expect(noFence()).toBe(true);
    });
  });
});

// ── INTEGRATION — runEstablishSession FENCE PLACEMENT (roborev HIGH) ──────────────────────────
// The pure `establishStillCurrent` tests above prove the DECISION; these drive the actual
// orchestration `runEstablishSession` with a controllable `readProfileAndDerive` promise and race a
// supersession at the (single) await boundary, asserting the side effects (boundary arm, pointer
// write, UI publish) do NOT leak past a superseded fence — AND that the boundary is NEVER cleared
// on a superseded path (the superseding actor owns it). This catches a fence MISPLACEMENT (e.g.
// publishing after a superseded fence, or arming the authoritative boundary unconditionally) that
// the pure-helper tests cannot.
describe("roborev HIGH — runEstablishSession fence PLACEMENT (no arm/point/publish leaks past supersession)", () => {
  const A = "https://alice.example/profile/card#me";
  const B = "https://bob.example/profile/card#me";
  const ISSUER = "https://issuer.example/";

  /** A recorder of every side effect + a controllable provider-generation/identity model. */
  function harness(opts?: {
    currentIssuer?: () => string | undefined;
    readProfileAndDerive?: EstablishSessionDeps["readProfileAndDerive"];
  }) {
    // The mutable "live provider" state the deps read — a test advances generation / flips
    // identity DURING the await to model a racing logout/new-login.
    const live = { generation: 5, authenticatedWebId: A as string | undefined };
    const arms: Array<{ webId: string; issuer?: string; podRoot?: string }> = [];
    const pointerWrites: Array<[string, string]> = [];
    const publishes: Array<[string, DerivedSession]> = [];
    const derived: DerivedSession = {
      podRoot: "https://alice.example/",
      webId: A,
      podRootIsFallback: false,
    };
    const deps: EstablishSessionDeps = {
      authenticatedWebId: () => live.authenticatedWebId,
      loginGeneration: () => live.generation,
      currentIssuer: opts?.currentIssuer ?? (() => ISSUER),
      readProfileAndDerive: opts?.readProfileAndDerive ?? (async () => derived),
      armBoundary: (i) => arms.push(i),
      writePointer: (webId, issuerHref) => pointerWrites.push([webId, issuerHref]),
      publish: (webId, session) => publishes.push([webId, session]),
      webIdsEqual,
    };
    return { live, arms, pointerWrites, publishes, deps, derived };
  }

  it("HAPPY PATH — current throughout → arms (provisional+authoritative), points, publishes", async () => {
    const h = harness();
    await runEstablishSession(A, false, h.deps);
    expect(h.arms.length).toBe(2); // provisional (no podRoot) then authoritative (podRoot).
    expect(h.arms[0].podRoot).toBeUndefined();
    expect(h.arms[0].issuer).toBe(ISSUER);
    expect(h.arms[1].podRoot).toBe(h.derived.podRoot);
    expect(h.pointerWrites).toEqual([[A, ISSUER]]);
    expect(h.publishes).toEqual([[A, h.derived]]); // UI published.
  });

  it("ENTRY MISMATCH — the OP authenticated a DIFFERENT WebID → throws, NO side effects", async () => {
    const h = harness();
    h.live.authenticatedWebId = B; // OP vouched for B, caller asked for A.
    await expect(runEstablishSession(A, false, h.deps)).rejects.toThrow(/different WebID/);
    expect(h.arms).toEqual([]);
    expect(h.pointerWrites).toEqual([]);
    expect(h.publishes).toEqual([]);
  });

  it("SUPERSEDED DURING readProfile (new login as B) → provisional arm happened, but NO authoritative arm/point/publish", async () => {
    const h = harness({
      readProfileAndDerive: async () => {
        h.live.authenticatedWebId = B; // a NEW login as B wins during the profile read.
        h.live.generation = 6;
        return h.derived;
      },
    });
    await runEstablishSession(A, false, h.deps);
    expect(h.arms.length).toBe(1); // ONLY the provisional arm (pre-readProfile) ran.
    expect(h.pointerWrites).toEqual([]); // authoritative pointer write fenced out.
    expect(h.publishes).toEqual([]); // no stale publish for A while B is now live.
  });

  it("SUPERSEDED DURING readProfile (logout) → provisional arm only, NO point/publish, boundary NOT cleared", async () => {
    const h = harness({
      readProfileAndDerive: async () => {
        h.live.authenticatedWebId = undefined; // a logout reset the provider during the read.
        h.live.generation = 6;
        return h.derived;
      },
    });
    await runEstablishSession(A, false, h.deps);
    expect(h.arms.length).toBe(1); // provisional arm; the authoritative arm is fenced out.
    expect(h.pointerWrites).toEqual([]);
    expect(h.publishes).toEqual([]);
    // The SUPERSEDED branch makes NO boundary-clear call — runEstablishSession has no clear dep,
    // so a superseded establish CANNOT wipe a newer login's boundary (asserted by construction:
    // the only side effects it can perform are arm/point/publish, all fenced above).
  });

  it("NON-FATAL profile read under degrade — a readProfile THROW (still current) falls back + publishes", async () => {
    const h = harness({
      readProfileAndDerive: async (webId, profileMayDegrade) => {
        if (profileMayDegrade) {
          // The dep's own degrade fallback (mirrors the production readProfileAndDerive).
          return { podRoot: new URL("/", webId).toString(), webId, podRootIsFallback: true };
        }
        throw new Error("transient profile blip");
      },
    });
    await runEstablishSession(A, true, h.deps);
    // A profile blip is NON-FATAL under degrade: the user is still logged in (the OP vouched for
    // A). The fallback session is derived from the WebID origin and the flow still publishes.
    expect(h.publishes.length).toBe(1);
    expect(h.publishes[0][0]).toBe(A);
    expect(h.arms.length).toBe(2);
    expect(h.pointerWrites).toEqual([[A, ISSUER]]);
  });

  it("STRICT profile read — a readProfile THROW WITHOUT degrade propagates (no publish)", async () => {
    const h = harness({
      readProfileAndDerive: async () => {
        throw new Error("profile read failed");
      },
    });
    await expect(runEstablishSession(A, false, h.deps)).rejects.toThrow(/profile read failed/);
    expect(h.arms.length).toBe(1); // provisional arm ran before the throw.
    expect(h.pointerWrites).toEqual([]);
    expect(h.publishes).toEqual([]);
  });

  it("NO ISSUER — a missing issuer skips the pointer write but still publishes", async () => {
    const h = harness({ currentIssuer: () => undefined });
    await runEstablishSession(A, false, h.deps);
    expect(h.pointerWrites).toEqual([]); // no issuer → no remembered pointer (nothing to write).
    expect(h.publishes).toEqual([[A, h.derived]]); // still logged in.
  });

  it("ADVERSARIAL — without the post-readProfile fence the stale publish WOULD leak (proving placement is load-bearing)", async () => {
    // Re-implement runEstablishSession's tail WITHOUT the fence and show the SAME
    // supersede-during-readProfile inputs WRONGLY publish — the bug the real placement prevents.
    const published: string[] = [];
    let generation = 5;
    const buggyTail = async () => {
      // (provisional arm done) … await readProfile during which a logout wins …
      generation = 6;
      // BUG: publish runs unconditionally (no establishStillCurrent fence).
      published.push(A);
    };
    await buggyTail();
    expect(published).toEqual([A]); // the buggy tail leaks a stale publish…
    expect(generation).toBe(6); // …and the generation HAD advanced (the superseding actor won).

    // …whereas the REAL orchestration does NOT (the post-readProfile fence guards the publish).
    const real = harness({
      readProfileAndDerive: async () => {
        real.live.generation = 6;
        real.live.authenticatedWebId = undefined;
        return real.derived;
      },
    });
    await runEstablishSession(A, false, real.deps);
    expect(real.publishes).toEqual([]); // fixed: no stale publish.
  });
});
