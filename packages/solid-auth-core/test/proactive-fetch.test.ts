// AUTHORED-BY Claude Fable 5
// (Ported from @jeswr/solid-elements test/proactive-fetch.test.ts — this package
// is the wrapper's new home; only import paths changed in the port.)
//
// Tests for proactive-fetch — the generic, reusable proactive authenticated-fetch
// installer (task #123). Ported + generalized from @jeswr/pod-drive's proven
// `web/src/auth/proactive-fetch.test.ts` (21 cases). SECURITY-CRITICAL: the credential
// boundary (which origins the DPoP token may ride to) is exhaustively exercised here.
// The behaviours under test:
//   1. PROACTIVE attach — the token is attached on the FIRST request to an allowed origin
//      (no 401 needed) → eliminates the per-resource 401-dance.
//   2. The CREDENTIAL BOUNDARY — a foreign / cleartext / unparseable origin is left
//      UNAUTHENTICATED (fail-closed), even though the wrapped provider's `upgrade()` is
//      unconditional. This is the adversarial half: a mismatch test must genuinely FAIL
//      without the `isOriginAllowed` gate.
//   3. ONE bounded 401 re-upgrade; transport errors propagate; only a SUPERSEDED upgrade
//      error downgrades to public.
//   4. The installer: global patch (once-only + live state), the non-global handle, the
//      pristine-fetch capture, and a custom supersession predicate.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetProactiveFetchForTests,
  deriveProactiveAllowedOrigins,
  installProactiveAuthFetch,
  isProviderOAuthRequest,
  isReactiveAuthResetError,
  type ProactiveFetchState,
  type ProactiveTokenProvider,
  proactiveAuthenticatedFetch,
} from "../src/index.js";

/** A provider double whose `upgrade` stamps an `Authorization: DPoP <token>` header so the
 * test can assert the token WAS (or was NOT) attached, by inspecting the Request the base
 * fetch received. It records every URL it was asked to upgrade. */
function fakeProvider(token = "tok-abc"): ProactiveTokenProvider & {
  upgradeCalls: string[];
} {
  const upgradeCalls: string[] = [];
  return {
    upgradeCalls,
    async upgrade(request: Request): Promise<Request> {
      upgradeCalls.push(request.url);
      const headers = new Headers(request.headers);
      headers.set("Authorization", `DPoP ${token}`);
      headers.set("DPoP", "proof-jwt");
      return new Request(request, { headers });
    },
  };
}

/** A base fetch double that returns a scripted sequence of statuses (one per call) and
 * records the Authorization header of every Request it received. */
function scriptedBase(statuses: number[]): {
  fetch: typeof fetch;
  authHeaders: (string | null)[];
  calls: number;
} {
  const authHeaders: (string | null)[] = [];
  let i = 0;
  const rec = { authHeaders, calls: 0 };
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as RequestInfo, init);
    rec.calls += 1;
    authHeaders.push(req.headers.get("Authorization"));
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return {
    fetch: fn,
    authHeaders,
    get calls() {
      return rec.calls;
    },
  } as never;
}

const POD = "https://alice.pod.example";
const FOREIGN = "https://evil.example";

afterEach(() => {
  __resetProactiveFetchForTests();
  vi.restoreAllMocks();
});

describe("deriveProactiveAllowedOrigins — the credential boundary (delegates to the seam)", () => {
  it("includes the pod root, WebID, and issuer origins (https)", () => {
    const allowed = deriveProactiveAllowedOrigins({
      podRoot: "https://pod.example/alice/",
      webId: "https://id.example/alice#me",
      issuer: "https://op.example/",
      allowInsecureLoopback: false,
    });
    expect(allowed.has("https://pod.example")).toBe(true);
    expect(allowed.has("https://id.example")).toBe(true);
    expect(allowed.has("https://op.example")).toBe(true);
  });

  it("DROPS a cleartext http:// non-loopback pod origin (no token over cleartext)", () => {
    const allowed = deriveProactiveAllowedOrigins({
      podRoot: "http://pod.example/alice/",
      webId: "https://id.example/alice#me",
      allowInsecureLoopback: false,
    });
    expect(allowed.has("http://pod.example")).toBe(false);
    // The https WebID origin is still admitted.
    expect(allowed.has("https://id.example")).toBe(true);
  });

  it("admits an http://localhost pod origin ONLY under allowInsecureLoopback (dev/test)", () => {
    const off = deriveProactiveAllowedOrigins({
      podRoot: "http://localhost:3000/alice/",
      allowInsecureLoopback: false,
    });
    expect(off.has("http://localhost:3000")).toBe(false);

    const on = deriveProactiveAllowedOrigins({
      podRoot: "http://localhost:3000/alice/",
      allowInsecureLoopback: true,
    });
    expect(on.has("http://localhost:3000")).toBe(true);
  });

  it("is empty (fail-closed) when nothing is supplied", () => {
    expect(deriveProactiveAllowedOrigins({ allowInsecureLoopback: false }).size).toBe(0);
    expect(deriveProactiveAllowedOrigins({}).size).toBe(0);
  });

  it("folds in extraOrigins (a media host / second pod on another host)", () => {
    const allowed = deriveProactiveAllowedOrigins({
      podRoot: "https://pod.example/alice/",
      extraOrigins: ["https://media.example/x", "http://cleartext.example", "::::"],
      webId: "https://id.example/alice#me",
    });
    expect(allowed.has("https://pod.example")).toBe(true);
    expect(allowed.has("https://media.example")).toBe(true);
    // extraOrigins are subject to the SAME cleartext / parse guards as the rest.
    expect(allowed.has("http://cleartext.example")).toBe(false);
  });

  it("can drop the WebID / issuer defaults (rely solely on podRoot + extraOrigins)", () => {
    const allowed = deriveProactiveAllowedOrigins({
      podRoot: "https://pod.example/alice/",
      webId: "https://id.example/alice#me",
      issuer: "https://op.example/",
      includeWebIdOrigin: false,
      includeIssuerOrigin: false,
    });
    expect(allowed.has("https://pod.example")).toBe(true);
    expect(allowed.has("https://id.example")).toBe(false);
    expect(allowed.has("https://op.example")).toBe(false);
  });
});

describe("proactiveAuthenticatedFetch — PROACTIVE attach (the 401-dance fix)", () => {
  it("attaches the token on the FIRST request to an allowed origin (no 401 needed)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([POD]),
    };
    const res = await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(res.status).toBe(200);
    // ONE base call, and it carried the token — NO wasted unauthenticated round-trip.
    expect(base.calls).toBe(1);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    expect(provider.upgradeCalls).toEqual([`${POD}/c/file1`]);
  });

  it("does NOT scale 401s with child count — N children pay ZERO wasted 401s", async () => {
    const provider = fakeProvider();
    // Every request 200s on the FIRST (proactively-authenticated) call.
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    const N = 25;
    for (let n = 0; n < N; n++) {
      const r = await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/child-${n}`);
      expect(r.status).toBe(200);
    }
    // Exactly N base calls (one per child), each authenticated. The reactive manager would
    // have made 2N (a 401 then a retry per child); proactive makes N.
    expect(base.calls).toBe(N);
    expect(base.authHeaders.every((h) => h === "DPoP tok-abc")).toBe(true);
  });
});

describe("proactiveAuthenticatedFetch — the credential boundary (ADVERSARIAL)", () => {
  it("does NOT attach the token to a FOREIGN origin (left unauthenticated)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = {
      provider,
      // Only the pod is allowed; the foreign origin is NOT.
      allowedOrigins: new Set([POD]),
    };
    const res = await proactiveAuthenticatedFetch(state, base.fetch, `${FOREIGN}/steal`);
    expect(res.status).toBe(200);
    // The token was NEVER attached and `upgrade` was NEVER called for the foreign origin.
    expect(base.authHeaders[0]).toBeNull();
    expect(provider.upgradeCalls).toEqual([]);
  });

  it("ADVERSARIAL: a foreign request WOULD be authenticated if the origin gate were removed", async () => {
    // This proves the `isOriginAllowed` gate is load-bearing. We simulate "no gate" by
    // putting the foreign origin IN the allowed set — if origin gating were a no-op, the
    // production path would behave like this. The token IS attached → demonstrating the gate
    // (an allowed set that EXCLUDES the foreign origin) is what prevents the leak.
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const leakyState: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([FOREIGN]), // the gate is what we'd be missing
    };
    await proactiveAuthenticatedFetch(leakyState, base.fetch, `${FOREIGN}/steal`);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    // ...and the SAME request with a CORRECT boundary (foreign excluded) does NOT leak:
    const base2 = scriptedBase([200]);
    const safeState: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    await proactiveAuthenticatedFetch(safeState, base2.fetch, `${FOREIGN}/steal`);
    expect(base2.authHeaders[0]).toBeNull();
  });

  it("authenticates NOTHING when the allowed set is empty (logged out / fail-closed)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set() };
    await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(base.authHeaders[0]).toBeNull();
    expect(provider.upgradeCalls).toEqual([]);
  });

  it("authenticates NOTHING when there is no provider (no live session)", async () => {
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = { provider: null, allowedOrigins: new Set([POD]) };
    await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(base.authHeaders[0]).toBeNull();
  });

  it("leaves an unusual-scheme origin (data:) unauthenticated (fail-closed)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    // A `data:` URL forms a valid Request but its origin ("null") is never in the allowed
    // set — the seam's isOriginAllowed fails closed for any origin not explicitly admitted.
    await proactiveAuthenticatedFetch(state, base.fetch, "data:text/plain,hello");
    expect(base.authHeaders[0]).toBeNull();
    expect(provider.upgradeCalls).toEqual([]);
  });
});

describe("proactiveAuthenticatedFetch — ONE bounded 401 retry", () => {
  it("re-upgrades and retries exactly ONCE on a 401, then returns the retry response", async () => {
    const provider = fakeProvider();
    // First (proactive) attempt 401s; the single retry 200s.
    const base = scriptedBase([401, 200]);
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    const res = await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(res.status).toBe(200);
    expect(base.calls).toBe(2); // exactly one retry
    // Both calls carried the token (proactive attach + re-upgrade).
    expect(base.authHeaders).toEqual(["DPoP tok-abc", "DPoP tok-abc"]);
    // `upgrade` was called twice (proactive + retry), the second on the cloned body.
    expect(provider.upgradeCalls.length).toBe(2);
  });

  it("does NOT loop: a still-401 retry returns the 401 (bounded, no third attempt)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([401, 401]);
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    const res = await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(res.status).toBe(401);
    expect(base.calls).toBe(2); // proactive + ONE retry, then give up
  });

  it("replays the request BODY on the retry (the clone-before-fetch invariant)", async () => {
    const provider = fakeProvider();
    const seenBodies: string[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      seenBodies.push(await req.text());
      // 401 first → forces a retry whose body must NOT be empty.
      return new Response(null, { status: seenBodies.length === 1 ? 401 : 200 });
    }) as unknown as typeof fetch;
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    const res = await proactiveAuthenticatedFetch(state, base, `${POD}/c/file1`, {
      method: "PUT",
      body: "the-payload",
    });
    expect(res.status).toBe(200);
    // BOTH the first attempt AND the retry carried the body (clone teed it pre-fetch).
    expect(seenBodies).toEqual(["the-payload", "the-payload"]);
  });

  it("PROPAGATES a transport error from the authenticated fetch — no silent public retry", async () => {
    // A network/CORS/abort failure of the AUTHENTICATED `base()` must NOT silently downgrade
    // to a second UNAUTHENTICATED request (that would duplicate a non-idempotent write + mask
    // the real error). Only a provider.upgrade() rejection falls back to public. Here
    // `upgrade` succeeds, then `base` throws — the error must propagate AND `base` must have
    // been called exactly ONCE (no public retry).
    const provider = fakeProvider();
    let baseCalls = 0;
    const transportError = new TypeError("Failed to fetch");
    const base = (async () => {
      baseCalls += 1;
      throw transportError;
    }) as unknown as typeof fetch;
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    await expect(
      proactiveAuthenticatedFetch(state, base, `${POD}/c/file1`, {
        method: "PUT",
        body: "x",
      }),
    ).rejects.toBe(transportError);
    expect(baseCalls).toBe(1); // exactly one (authenticated) attempt — NO public duplicate
  });

  it("falls back to PUBLIC only on a SUPERSEDED (reset-race) upgrade error", async () => {
    // A logout / relogin reset the provider mid-flight → upgrade() rejects with a
    // ReactiveAuthResetError. THAT is safe to absorb into an unauthenticated request.
    const reset = Object.assign(new Error("superseded"), { name: "ReactiveAuthResetError" });
    const provider: ProactiveTokenProvider = {
      async upgrade() {
        throw reset;
      },
    };
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    const res = await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(res.status).toBe(200);
    // The fallback request was UNAUTHENTICATED (no token attached).
    expect(base.authHeaders[0]).toBeNull();
  });

  it("RETHROWS a non-supersession upgrade error (real auth failure stays an error)", async () => {
    // A genuine auth failure (cancelled login, discovery/token error, refresh failure) must
    // NOT be silently downgraded to a public request. Only a ReactiveAuthResetError is
    // absorbed; any other upgrade() rejection propagates.
    const authError = new Error("token endpoint 400");
    let baseCalls = 0;
    const provider: ProactiveTokenProvider = {
      async upgrade() {
        throw authError;
      },
    };
    const base = (async () => {
      baseCalls += 1;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    await expect(proactiveAuthenticatedFetch(state, base, `${POD}/c/file1`)).rejects.toBe(
      authError,
    );
    expect(baseCalls).toBe(0); // never fell back to a public request
  });

  it("honours a CUSTOM supersession predicate (provider signals reset its own way)", async () => {
    // A consumer whose provider throws a different supersession marker passes its own
    // predicate. The default (ReactiveAuthResetError name) must NOT absorb this error; the
    // custom predicate must.
    const custom = Object.assign(new Error("gone"), { code: "SESSION_SUPERSEDED" });
    const provider: ProactiveTokenProvider = {
      async upgrade() {
        throw custom;
      },
    };
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };

    // Without the custom predicate the default does NOT match → rethrow.
    const baseA = scriptedBase([200]);
    await expect(proactiveAuthenticatedFetch(state, baseA.fetch, `${POD}/c/file1`)).rejects.toBe(
      custom,
    );

    // WITH the custom predicate it is absorbed into an unauthenticated public request.
    const baseB = scriptedBase([200]);
    const res = await proactiveAuthenticatedFetch(state, baseB.fetch, `${POD}/c/file1`, undefined, {
      isSuperseded: (e) => (e as { code?: string }).code === "SESSION_SUPERSEDED",
    });
    expect(res.status).toBe(200);
    expect(baseB.authHeaders[0]).toBeNull();
  });

  it("absorbs a SUPERSEDED rejection on the RETRY upgrade too (replaying an intact body)", async () => {
    // The proactive attach 401s, then the RETRY upgrade() rejects with a reset-race (logout
    // during the retry). That is absorbed into an unauthenticated public request, and the
    // pre-upgrade clone still has an intact body.
    const reset = Object.assign(new Error("superseded"), { name: "ReactiveAuthResetError" });
    let upgradeCount = 0;
    const provider: ProactiveTokenProvider = {
      async upgrade(request: Request): Promise<Request> {
        upgradeCount += 1;
        if (upgradeCount === 1) {
          const headers = new Headers(request.headers);
          headers.set("Authorization", "DPoP tok-abc");
          return new Request(request, { headers });
        }
        throw reset; // retry upgrade superseded
      },
    };
    const seenBodies: string[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input as RequestInfo, init);
      seenBodies.push(await req.text());
      return new Response(null, { status: seenBodies.length === 1 ? 401 : 200 });
    }) as unknown as typeof fetch;
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    const res = await proactiveAuthenticatedFetch(state, base, `${POD}/c/file1`, {
      method: "PUT",
      body: "payload",
    });
    expect(res.status).toBe(200);
    // The public fallback carried the intact body.
    expect(seenBodies).toEqual(["payload", "payload"]);
  });

  it("does NOT authenticate the retry if the boundary was emptied between rounds (logout race)", async () => {
    // The proactive attach 401s; before the retry, a logout empties the live boundary. The
    // retry must be an UNAUTHENTICATED public request (re-checked gate), and upgrade() must
    // NOT be called a second time.
    const provider = fakeProvider();
    const base = scriptedBase([401, 200]);
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    // Hook the base so that after the FIRST (401) call we clear the boundary.
    let calls = 0;
    const racingBase = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await base.fetch(input, init);
      calls += 1;
      if (calls === 1) state.allowedOrigins = new Set(); // logout between rounds
      return r;
    }) as unknown as typeof fetch;
    const res = await proactiveAuthenticatedFetch(state, racingBase, `${POD}/c/file1`);
    expect(res.status).toBe(200);
    // Proactive attach was authenticated; the retry was NOT (boundary emptied).
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    expect(base.authHeaders[1]).toBeNull();
    expect(provider.upgradeCalls.length).toBe(1); // no second upgrade
  });
});

describe("installProactiveAuthFetch — the global patch (once-only + live state)", () => {
  it("patches globalThis.fetch and proactively authenticates an allowed origin", async () => {
    const provider = fakeProvider();
    const original = globalThis.fetch;
    const base = scriptedBase([200]);
    // Make the captured-pristine fetch our scripted base.
    globalThis.fetch = base.fetch;
    try {
      const install = installProactiveAuthFetch();
      // Patched: the global is no longer the base we set.
      expect(globalThis.fetch).not.toBe(base.fetch);
      expect(install.patchedGlobal).toBe(true);
      install.setState({ provider, allowedOrigins: new Set([POD]) });
      await globalThis.fetch(`${POD}/c/file1`);
      expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("is once-only: a second install returns the SAME handle (no stacked patch)", () => {
    const original = globalThis.fetch;
    try {
      const a = installProactiveAuthFetch();
      const patchedOnce = globalThis.fetch;
      const b = installProactiveAuthFetch();
      expect(b).toBe(a);
      // The global was not re-wrapped a second time.
      expect(globalThis.fetch).toBe(patchedOnce);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reflects setState live: clearing the boundary stops authenticating (logout)", async () => {
    const provider = fakeProvider();
    const original = globalThis.fetch;
    const base = scriptedBase([200]);
    globalThis.fetch = base.fetch;
    try {
      const install = installProactiveAuthFetch();
      install.setState({ provider, allowedOrigins: new Set([POD]) });
      await globalThis.fetch(`${POD}/a`);
      expect(base.authHeaders[0]).toBe("DPoP tok-abc");
      // LOGOUT: clear the boundary → the very next request is unauthenticated.
      install.setState({ provider: null, allowedOrigins: new Set() });
      await globalThis.fetch(`${POD}/b`);
      expect(base.authHeaders[1]).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("exposes the pristine (pre-patch) fetch as pristineFetch (credential-free)", async () => {
    const original = globalThis.fetch;
    const base = scriptedBase([200]);
    globalThis.fetch = base.fetch;
    try {
      const install = installProactiveAuthFetch();
      // The captured pristine is NOT the patched global (it is a `.bind(globalThis)` of the
      // pre-patch fetch, so it is reference-distinct from both the patched global AND the
      // raw base — we assert it FUNCTIONALLY routes to the base, credential-free).
      expect(install.pristineFetch).not.toBe(globalThis.fetch);
      install.setState({ provider: fakeProvider(), allowedOrigins: new Set([POD]) });
      // A direct pristineFetch call NEVER attaches a token (it is the pre-patch fetch),
      // even to an allowed origin with a live provider armed — the re-entrancy-safe path.
      await install.pristineFetch(`${POD}/c/file1`);
      expect(base.authHeaders[0]).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("the patched wrapper runs over the PRISTINE fetch, never the live (re-patched) global", async () => {
    // RE-ENTRANCY guard: even if the global is overwritten AFTER install, our wrapper still
    // issues over the pristine snapshot — so a provider's token request pinned to pristine
    // can't re-enter the patch.
    const provider = fakeProvider();
    const original = globalThis.fetch;
    const pristine = scriptedBase([200]);
    globalThis.fetch = pristine.fetch;
    try {
      const install = installProactiveAuthFetch();
      install.setState({ provider, allowedOrigins: new Set([POD]) });
      // Someone replaces the global with a throwing fetch AFTER install.
      globalThis.fetch = (async () => {
        throw new Error("re-entered the patched/replaced global");
      }) as unknown as typeof fetch;
      // The install's wrapper still goes through the captured pristine base — no re-entry.
      const res = await install.fetch(`${POD}/c/file1`);
      expect(res.status).toBe(200);
      expect(pristine.authHeaders[0]).toBe("DPoP tok-abc");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("patchGlobal:false builds a FRESH handle that does NOT touch globalThis.fetch", async () => {
    const provider = fakeProvider();
    const original = globalThis.fetch;
    const pristine = scriptedBase([200]);
    try {
      const install = installProactiveAuthFetch({
        patchGlobal: false,
        pristineFetch: pristine.fetch,
      });
      expect(install.patchedGlobal).toBe(false);
      // The global is untouched.
      expect(globalThis.fetch).toBe(original);
      // The non-global install is NOT the page singleton — a second one is a different handle.
      const install2 = installProactiveAuthFetch({
        patchGlobal: false,
        pristineFetch: pristine.fetch,
      });
      expect(install2).not.toBe(install);
      // Routing through `.fetch` still proactively authenticates an allowed origin.
      install.setState({ provider, allowedOrigins: new Set([POD]) });
      await install.fetch(`${POD}/c/file1`);
      expect(pristine.authHeaders[0]).toBe("DPoP tok-abc");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("honours an injected pristineFetch + initial state at install time", async () => {
    const provider = fakeProvider();
    const original = globalThis.fetch;
    const injected = scriptedBase([200]);
    try {
      const install = installProactiveAuthFetch({
        patchGlobal: false,
        pristineFetch: injected.fetch,
        initial: { provider, allowedOrigins: new Set([POD]) },
      });
      expect(install.pristineFetch).toBe(injected.fetch);
      // The initial state armed the boundary already (no setState needed).
      await install.fetch(`${POD}/c/file1`);
      expect(injected.authHeaders[0]).toBe("DPoP tok-abc");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("isReactiveAuthResetError — the default supersession predicate", () => {
  it("matches an Error named ReactiveAuthResetError, nothing else", () => {
    expect(
      isReactiveAuthResetError(Object.assign(new Error("x"), { name: "ReactiveAuthResetError" })),
    ).toBe(true);
    expect(isReactiveAuthResetError(new Error("plain"))).toBe(false);
    expect(isReactiveAuthResetError({ name: "ReactiveAuthResetError" })).toBe(false); // not an Error
    expect(isReactiveAuthResetError(null)).toBe(false);
    expect(isReactiveAuthResetError("ReactiveAuthResetError")).toBe(false);
  });
});

// ─── #123 PM PARITY — capability 1: provider-internal OAuth bypass (issuer-scoped) ─────────

const ISSUER = "https://idp.example"; // a shared CSS topology: pod + IdP on ONE origin
const issuerSet = new Set([ISSUER]);

/** Build a Request to a URL with optional headers (so we can stamp a DPoP proof header). */
function req(url: string, headers?: Record<string, string>): Request {
  return new Request(url, headers ? { headers } : undefined);
}

describe("isProviderOAuthRequest — the provider-internal OAuth bypass (PURE, adversarial)", () => {
  it("TRUE for an issuer-origin request carrying a DPoP PROOF header (token/refresh call)", () => {
    // oauth4webapi stamps a `DPoP` proof on every token/refresh request.
    expect(isProviderOAuthRequest(req(`${ISSUER}/token`, { DPoP: "proof-jwt" }), issuerSet)).toBe(
      true,
    );
  });

  it("TRUE for an issuer-origin /.well-known/ path (header-less discovery GET)", () => {
    expect(
      isProviderOAuthRequest(req(`${ISSUER}/.well-known/openid-configuration`), issuerSet),
    ).toBe(true);
  });

  it("TRUE for an issuer-origin /.oidc/ path", () => {
    expect(isProviderOAuthRequest(req(`${ISSUER}/.oidc/jwks`), issuerSet)).toBe(true);
  });

  it("FALSE for a RESOURCE request on the issuer origin WITHOUT a DPoP/well-known signal", () => {
    // A pod write to a resource that happens to share the IdP origin is NOT provider-internal —
    // it must keep the full auth path (the roborev finding: do not bypass on Authorization alone).
    expect(isProviderOAuthRequest(req(`${ISSUER}/alice/notes/n1`), issuerSet)).toBe(false);
    // Even with an Authorization header pre-set by the caller, it is still a resource request.
    expect(
      isProviderOAuthRequest(
        req(`${ISSUER}/alice/notes/n1`, { Authorization: "DPoP caller-token" }),
        issuerSet,
      ),
    ).toBe(false);
  });

  it("FALSE for a NON-issuer origin even with a DPoP header or a well-known path", () => {
    expect(isProviderOAuthRequest(req(`${POD}/token`, { DPoP: "proof-jwt" }), issuerSet)).toBe(
      false,
    );
    expect(isProviderOAuthRequest(req(`${POD}/.well-known/openid-configuration`), issuerSet)).toBe(
      false,
    );
  });

  it("FALSE when the issuer set is empty (logged out → nothing is provider-internal)", () => {
    expect(isProviderOAuthRequest(req(`${ISSUER}/token`, { DPoP: "proof-jwt" }), new Set())).toBe(
      false,
    );
  });

  it("FAIL-CLOSED on an unparseable URL (not treated as provider-internal)", () => {
    // A Request whose url getter throws / is unparseable must not be classified as OAuth.
    const broken = { url: "::::not a url::::", headers: new Headers() } as unknown as Request;
    expect(isProviderOAuthRequest(broken, issuerSet)).toBe(false);
  });
});

describe("proactiveAuthenticatedFetch — issuerOrigins OAuth bypass (#123 PM parity)", () => {
  it("leaves a provider-internal OAuth request on the issuer origin UNAUTHENTICATED", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    // The issuer origin is ALSO an allowed (resource) origin — the shared-CSS topology.
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([ISSUER, POD]),
      issuerOrigins: issuerSet,
    };
    // A token/refresh call (DPoP proof header) to the issuer origin must NOT be wrapped.
    await proactiveAuthenticatedFetch(state, base.fetch, `${ISSUER}/token`, {
      headers: { DPoP: "oauth4webapi-proof" },
    });
    expect(provider.upgradeCalls).toEqual([]); // provider.upgrade NEVER called on it
    // The request still went out (it carries only oauth4webapi's own DPoP, no wrapper token).
    expect(base.authHeaders[0]).toBeNull();
  });

  it("STILL upgrades a pod resource request on a DIFFERENT allowed origin", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([ISSUER, POD]),
      issuerOrigins: issuerSet,
    };
    await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    expect(provider.upgradeCalls).toEqual([`${POD}/c/file1`]);
  });

  it("STILL upgrades a RESOURCE request on the issuer origin (no DPoP/well-known signal)", async () => {
    // Pod served from the IdP origin: a plain resource read there is NOT provider-internal.
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([ISSUER]),
      issuerOrigins: issuerSet,
    };
    await proactiveAuthenticatedFetch(state, base.fetch, `${ISSUER}/alice/notes/n1`);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    expect(provider.upgradeCalls).toEqual([`${ISSUER}/alice/notes/n1`]);
  });

  it("re-checks the OAuth bypass on the 401 retry (a header-less resource request is retried)", async () => {
    // A resource request on the issuer origin 401s then 200s — the bypass must NOT kick in on the
    // retry (the retry source is the pristine header-less request, still a resource request).
    const provider = fakeProvider();
    const base = scriptedBase([401, 200]);
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([ISSUER]),
      issuerOrigins: issuerSet,
    };
    const res = await proactiveAuthenticatedFetch(state, base.fetch, `${ISSUER}/alice/notes/n1`);
    expect(res.status).toBe(200);
    expect(base.calls).toBe(2);
    expect(provider.upgradeCalls.length).toBe(2); // proactive + retry, both authenticated
  });
});

// ─── #123 PM PARITY — capability 2: session-liveness gate (canAttachNonInteractively) ──────

describe("proactiveAuthenticatedFetch — canAttachNonInteractively gate (#123 PM parity)", () => {
  it("leaves an allowed-origin request UNAUTHENTICATED when the gate returns false (dead session)", async () => {
    // A passive on-load read for an account whose refresh token is DEAD must NOT call upgrade()
    // (which would start the interactive code flow / popup from a background fetch).
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([POD]),
      canAttachNonInteractively: () => false,
    };
    const res = await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(res.status).toBe(200);
    expect(base.authHeaders[0]).toBeNull();
    expect(provider.upgradeCalls).toEqual([]); // NEVER upgraded → no popup
  });

  it("upgrades as today when the gate returns true (renewable / explicit login)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([POD]),
      canAttachNonInteractively: () => true,
    };
    await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    expect(provider.upgradeCalls).toEqual([`${POD}/c/file1`]);
  });

  it("is read FRESH per request (a session that dies between requests stops authenticating)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    let alive = true;
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([POD]),
      canAttachNonInteractively: () => alive,
    };
    await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/a`);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    alive = false; // the refresh token dies
    await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/b`);
    expect(base.authHeaders[1]).toBeNull(); // next request is unauthenticated
  });

  it("re-checks the liveness gate on the 401 retry (session dies mid-flight → public retry)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([401, 200]);
    let alive = true;
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([POD]),
      canAttachNonInteractively: () => alive,
    };
    // Kill the session right after the first (401) attempt, before the retry.
    let calls = 0;
    const racingBase = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = await base.fetch(input, init);
      calls += 1;
      if (calls === 1) alive = false;
      return r;
    }) as unknown as typeof fetch;
    const res = await proactiveAuthenticatedFetch(state, racingBase, `${POD}/c/file1`);
    expect(res.status).toBe(200);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc"); // proactive attach authenticated
    expect(base.authHeaders[1]).toBeNull(); // retry left public (gate now false)
    expect(provider.upgradeCalls.length).toBe(1); // no second upgrade
  });
});

describe("backward compat — omitting both new seams is identical to before (pod-drive path)", () => {
  it("with NO issuerOrigins and NO liveness gate, an allowed-origin request upgrades as today", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    // The pod-drive-style state — only provider + allowedOrigins, the two new fields omitted.
    const state: ProactiveFetchState = { provider, allowedOrigins: new Set([POD]) };
    await proactiveAuthenticatedFetch(state, base.fetch, `${POD}/c/file1`);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
    expect(provider.upgradeCalls).toEqual([`${POD}/c/file1`]);
  });

  it("an empty issuerOrigins set is equivalent to omitting it (no bypass)", async () => {
    const provider = fakeProvider();
    const base = scriptedBase([200]);
    const state: ProactiveFetchState = {
      provider,
      allowedOrigins: new Set([ISSUER]),
      issuerOrigins: new Set(), // empty → nothing treated as provider-internal
    };
    // Even a DPoP-header request to the issuer origin is upgraded (empty issuer set ⇒ no bypass).
    await proactiveAuthenticatedFetch(state, base.fetch, `${ISSUER}/alice/notes/n1`);
    expect(base.authHeaders[0]).toBe("DPoP tok-abc");
  });
});
