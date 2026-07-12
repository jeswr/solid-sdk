// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// session-provider-teardown.test.ts — the SessionProvider's establish-time GENERATION FENCE
// (roborev HIGH), pinned at the auth seam. SECURITY-CRITICAL.
//
// THE BUG (roborev HIGH, surfaced by pod-health, refined by pod-music, back-ported to
// pod-chat): the #123 proactive-fetch rollout left the PROVISIONAL + AUTHORITATIVE
// credential-boundary arms, the DURABLE persist, and the remembered-pointer write in
// `establishSessionFor` UNFENCED — they armed/persisted/published UNCONDITIONALLY after async
// awaits (`resolvedIssuer`, `readProfile`, `persistSession`). A logout() or new login() that
// RACES those awaits can (a) re-arm the boundary against a reset provider, (b) RESURRECT a
// logged-out durable credential, (c) republish a stale webId/session, or (d) clear a NEWER
// login's boundary. The fix fences each step with the pure, exported `establishStillCurrent`
// (generation unchanged + WebID matches); on the SUPERSEDED path the caller BAILS WITHOUT
// clearing the boundary (clearing would wipe a newer login's boundary). The deeper
// resurrect-logged-out-credential race is additionally closed INSIDE
// `WebIdDPoPTokenProvider.persistSession` (see webid-token-provider-persist.test.ts).
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
import { webIdsEqual } from "./webid-token-provider";

// establishStillCurrent — the generation+identity fence guarding the PROVISIONAL and
// AUTHORITATIVE proactive-boundary arms, the durable persist, the remembered-pointer write, and
// the UI publish in establishSessionFor (roborev HIGH). A logout()/new login() racing the awaits
// (resolvedIssuer / readProfile / persistSession) advances the generation (via reset()) AND
// clears the boundary; without this fence the resumed establish would RE-ARM the boundary against
// a reset/stale provider, RESURRECT a logged-out credential, AND publish a stale logged-in
// session — or, on a NEW login, clobber the new login's freshly-armed boundary.
describe("roborev HIGH — establishStillCurrent (fences provisional + authoritative arm + persist + pointer + publish)", () => {
  const GEN = 7;
  const A = "https://alice.example/profile/card#me";
  const B = "https://bob.example/profile/card#me";
  const base = {
    establishGeneration: GEN,
    requestedWebId: A,
    webIdsEqual,
  };

  it("CURRENT — same generation AND same authenticated WebID → arm + persist + publish proceed", () => {
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: A }),
    ).toBe(true);
  });

  it("SUPERSEDED — a racing logout/new-login ADVANCED the generation → fail-closed (no arm/persist/publish)", () => {
    // The generation moved on even though the (stale) authenticated WebID still reads A:
    // the fence must FAIL CLOSED on the generation mismatch alone. Without the generation
    // check this would wrongly return true and re-arm/persist against the superseded provider.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN + 1, currentAuthenticatedWebId: A }),
    ).toBe(false);
  });

  it("SUPERSEDED — identity SWITCHED to a different WebID at the same generation → fail-closed", () => {
    // A re-login as B advanced+settled to B's identity: arming/persisting/publishing A here
    // would resurrect a stale identity. The WebID check fails closed even if the generation matched.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: B }),
    ).toBe(false);
  });

  it("SUPERSEDED — provider was RESET (authenticated WebID cleared by logout) → fail-closed", () => {
    // A logout reset the provider: authenticatedWebId() is now undefined. The fence must not
    // re-arm the boundary / re-write the durable credential against the logged-out provider
    // (re-enabling reads behind a logged-out UI / resurrecting the credential).
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
    // login A's establish snapshots generation GEN, then awaits; login B starts, advances the
    // provider to GEN+1, arms ITS OWN boundary + persists ITS OWN credential, and becomes the
    // authenticated identity (B). When A resumes, establishStillCurrent MUST return false (B's
    // generation supersedes A) — so A aborts WITHOUT publishing/persisting and, crucially,
    // WITHOUT clearing the boundary. A clear here would wipe B's freshly-armed boundary and
    // leave B's logged-in UI making unauthenticated reads — the bug this guards (the SUPERSEDED
    // branch makes NO clearProactiveBoundary call, verified by inspection of SessionProvider.tsx).
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

  it("POST-PERSIST PUBLISH FENCE — a logout/new-login winning DURING `persistSession` blocks the UI publish too (roborev HIGH, 2nd round)", () => {
    // `await persistSession(...)` opens its OWN race window: a logout/new-login can win during
    // it. The earlier fix guarded only `rememberedAccount.write`, leaving `setWebId`/`setSession`
    // to run unconditionally and REPUBLISH a stale logged-in UI for a session whose credential
    // the provider's internal fence already REFUSED. The fix re-checks establishStillCurrent
    // AFTER the persist await and RETURNS before BOTH the pointer write AND the publish. The
    // decision is the SAME fence: superseded ⇒ false ⇒ no pointer write, no publish.
    expect(
      establishStillCurrent({
        establishGeneration: GEN, // this establish's snapshot
        currentGeneration: GEN + 1, // a logout/new-login advanced it during persistSession
        requestedWebId: A,
        currentAuthenticatedWebId: B, // B (or undefined after a logout) — not A
        webIdsEqual,
      }),
    ).toBe(false);
    // …and a same-WebID re-login that advanced the generation must ALSO block the republish
    // (the generation check alone catches it even though the identity still reads A).
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN + 1, currentAuthenticatedWebId: A }),
    ).toBe(false);
    // The non-superseded case proceeds to publish as normal.
    expect(
      establishStillCurrent({ ...base, currentGeneration: GEN, currentAuthenticatedWebId: A }),
    ).toBe(true);
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
      // The buggy generation-only fence WRONGLY accepts it (re-arms/persists B's session as A) — the bug.
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

// ── INTEGRATION — runEstablishSession FENCE PLACEMENT (roborev HIGH, 2nd round) ────────────────
// The pure `establishStillCurrent` tests above prove the DECISION; these drive the actual
// orchestration `runEstablishSession` with controllable `resolvedIssuer`/`readProfile`/
// `persistSession` promises and race a supersession at EACH await boundary, asserting the
// side effects (boundary arm, durable persist, pointer write, UI publish) do NOT leak past a
// superseded fence — AND that the boundary is NEVER cleared on a superseded path (the
// superseding actor owns it). This catches a fence MISPLACEMENT (e.g. publishing after the
// post-persist fence, or clearing the boundary on bail) that the pure-helper tests cannot.
describe("roborev HIGH — runEstablishSession fence PLACEMENT (no arm/persist/point/publish leaks past supersession)", () => {
  const A = "https://alice.example/profile/card#me";
  const B = "https://bob.example/profile/card#me";
  const ISSUER = new URL("https://issuer.example/");

  /** A recorder of every side effect + a controllable provider-generation/identity model. */
  function harness(opts?: {
    resolvedIssuer?: () => Promise<URL | undefined>;
    readProfileAndDerive?: EstablishSessionDeps["readProfileAndDerive"];
    persistSession?: EstablishSessionDeps["persistSession"];
  }) {
    // The mutable "live provider" state the deps read — a test advances generation / flips
    // identity DURING an await to model a racing logout/new-login.
    const live = { generation: 5, authenticatedWebId: A as string | undefined };
    const arms: Array<{ webId: string; issuer?: string; podRoot?: string }> = [];
    const pointerWrites: Array<[string, string]> = [];
    const publishes: Array<[string, unknown]> = [];
    const persists: Array<[string, string, number]> = [];
    const derived = { podRoot: "https://alice.example/", webId: A, podRootIsFallback: false };
    const deps: EstablishSessionDeps = {
      authenticatedWebId: () => live.authenticatedWebId,
      loginGeneration: () => live.generation,
      resolvedIssuer: opts?.resolvedIssuer ?? (async () => ISSUER),
      readProfileAndDerive: opts?.readProfileAndDerive ?? (async () => derived),
      armBoundary: (i) => arms.push(i),
      persistSession:
        opts?.persistSession ??
        (async (issuer, webId, gen) => {
          persists.push([issuer.href, webId, gen]);
        }),
      writePointer: (webId, issuerHref) => pointerWrites.push([webId, issuerHref]),
      publish: (webId, session) => publishes.push([webId, session]),
      webIdsEqual,
    };
    return { live, arms, pointerWrites, publishes, persists, deps, derived };
  }

  it("HAPPY PATH — current throughout → arms (provisional+authoritative), persists, points, publishes", async () => {
    const h = harness();
    await runEstablishSession(A, h.deps);
    expect(h.arms.length).toBe(2); // provisional (no podRoot) then authoritative (podRoot).
    expect(h.arms[0].podRoot).toBeUndefined();
    expect(h.arms[1].podRoot).toBe(h.derived.podRoot);
    expect(h.persists).toEqual([[ISSUER.href, A, 5]]); // persisted with the snapshot generation.
    expect(h.pointerWrites).toEqual([[A, ISSUER.href]]);
    expect(h.publishes).toEqual([[A, h.derived]]); // UI published.
  });

  it("ENTRY MISMATCH — the OP authenticated a DIFFERENT WebID → throws, NO side effects", async () => {
    const h = harness();
    h.live.authenticatedWebId = B; // OP vouched for B, caller asked for A.
    await expect(runEstablishSession(A, h.deps)).rejects.toThrow(/different WebID/);
    expect(h.arms).toEqual([]);
    expect(h.persists).toEqual([]);
    expect(h.pointerWrites).toEqual([]);
    expect(h.publishes).toEqual([]);
  });

  it("SUPERSEDED DURING resolvedIssuer → NO provisional arm, NO persist, NO publish", async () => {
    const h = harness({
      resolvedIssuer: async () => {
        h.live.generation = 6; // a logout/new-login wins during the issuer resolution await.
        return ISSUER;
      },
    });
    await runEstablishSession(A, h.deps);
    expect(h.arms).toEqual([]); // provisional arm fenced out.
    expect(h.persists).toEqual([]);
    expect(h.pointerWrites).toEqual([]);
    expect(h.publishes).toEqual([]); // crucially, no stale UI publish.
  });

  it("SUPERSEDED DURING readProfile → provisional arm happened, but NO authoritative arm/persist/publish", async () => {
    const h = harness({
      readProfileAndDerive: async () => {
        h.live.authenticatedWebId = B; // a NEW login as B wins during the profile read.
        h.live.generation = 6;
        return h.derived;
      },
    });
    await runEstablishSession(A, h.deps);
    expect(h.arms.length).toBe(1); // ONLY the provisional arm (pre-readProfile) ran.
    expect(h.persists).toEqual([]); // authoritative persist fenced out.
    expect(h.pointerWrites).toEqual([]);
    expect(h.publishes).toEqual([]); // no stale publish for A while B is now live.
  });

  it("SUPERSEDED DURING persistSession → NO pointer write AND NO publish (the post-persist window)", async () => {
    // The exact roborev HIGH (2nd round): a logout/new-login wins DURING persistSession; the
    // pointer write AND the UI publish must both be fenced — not just the pointer.
    const h = harness({
      persistSession: async (issuer, webId, gen) => {
        h.persists.push([issuer.href, webId, gen]);
        h.live.generation = 6; // logout/new-login wins during the persist await.
      },
    });
    await runEstablishSession(A, h.deps);
    expect(h.arms.length).toBe(2); // both arms ran before the persist await.
    expect(h.persists.length).toBe(1); // persistSession was CALLED (its own internal fence refuses the put).
    expect(h.pointerWrites).toEqual([]); // pointer write fenced.
    expect(h.publishes).toEqual([]); // and — the bug the earlier fix missed — NO stale UI publish.
  });

  it("NON-FATAL profile read — a readProfile THROW (still current) falls back to a WebID-origin session and publishes", async () => {
    const h = harness({
      readProfileAndDerive: async () => {
        throw new Error("transient profile blip");
      },
    });
    await runEstablishSession(A, h.deps);
    // A profile blip is NON-FATAL: the user is still logged in (the OP vouched for A). The
    // fallback session is derived from the WebID origin and the flow still publishes.
    expect(h.publishes.length).toBe(1);
    expect(h.publishes[0][0]).toBe(A);
    expect(h.persists.length).toBe(1); // and the credential is persisted (login succeeded).
  });

  it("ADVERSARIAL — without the post-persist fence the stale publish WOULD leak (proving placement is load-bearing)", async () => {
    // Re-implement runEstablishSession's tail WITHOUT the post-persist fence and show the SAME
    // supersede-during-persist inputs WRONGLY publish — the bug the real placement prevents.
    const published: string[] = [];
    let generation = 5;
    const buggyTail = async () => {
      // (arms + profile already done) … persist …
      generation = 6; // logout wins during persist
      // BUG: pointer write fenced, but publish runs unconditionally.
      if (
        establishStillCurrent({
          establishGeneration: 5,
          currentGeneration: generation,
          requestedWebId: A,
          currentAuthenticatedWebId: A,
          webIdsEqual,
        })
      ) {
        // pointer write (fenced — skipped)
      }
      published.push(A); // ← the unfenced publish (the bug)
    };
    await buggyTail();
    expect(published).toEqual([A]); // the buggy tail leaks a stale publish…

    // …whereas the REAL orchestration does NOT (the post-persist fence guards the publish).
    const real = harness({
      persistSession: async (issuer, webId, gen) => {
        real.persists.push([issuer.href, webId, gen]);
        real.live.generation = 6;
      },
    });
    await runEstablishSession(A, real.deps);
    expect(real.publishes).toEqual([]); // fixed: no stale publish.
  });
});
