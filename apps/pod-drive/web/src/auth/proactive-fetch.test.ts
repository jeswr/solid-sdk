// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for proactive-fetch.ts — the @jeswr/solid-elements seam-based replacement for
// the raw ReactiveFetchManager (task #123). SECURITY-CRITICAL: the credential boundary
// (which origins the DPoP token may ride to) is exhaustively exercised here. The two
// behaviours under test:
//   1. PROACTIVE attach — the token is attached on the FIRST request to an allowed
//      origin (no 401 needed) → eliminates the per-resource 401-dance.
//   2. The CREDENTIAL BOUNDARY — a foreign / cleartext / unparseable origin is left
//      UNAUTHENTICATED (fail-closed), even though the wrapped provider's `matches()` is
//      unconditional. This is the adversarial half: a mismatch test must genuinely FAIL
//      without the `isOriginAllowed` gate.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetProactiveFetchForTests,
  deriveProactiveAllowedOrigins,
  installProactiveAuthFetch,
  type ProactiveFetchState,
  type ProactiveTokenProvider,
  proactiveAuthenticatedFetch,
} from "./proactive-fetch";

/** A provider double whose `upgrade` stamps an `Authorization: DPoP <token>` header so
 * the test can assert the token WAS (or was NOT) attached, by inspecting the Request the
 * base fetch received. It records every URL it was asked to upgrade. */
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
    // Exactly N base calls (one per child), each authenticated. The reactive manager
    // would have made 2N (a 401 then a retry per child); proactive makes N.
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
    // production path would behave like this. The token IS attached → demonstrating the
    // gate (an allowed set that EXCLUDES the foreign origin) is what prevents the leak.
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
    // roborev finding: a network/CORS/abort failure of the AUTHENTICATED `base()` must NOT
    // silently downgrade to a second UNAUTHENTICATED request (that would duplicate a
    // non-idempotent write + mask the real error). Only a provider.upgrade() rejection
    // falls back to public. Here `upgrade` succeeds, then `base` throws — the error must
    // propagate AND `base` must have been called exactly ONCE (no public retry).
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
    // roborev finding: a genuine auth failure (cancelled login, discovery/token error,
    // refresh failure) must NOT be silently downgraded to a public request. Only a
    // ReactiveAuthResetError is absorbed; any other upgrade() rejection propagates.
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

  it("exposes the pristine (pre-patch) fetch as pristineFetch", () => {
    const original = globalThis.fetch;
    const base = scriptedBase([200]);
    globalThis.fetch = base.fetch;
    try {
      const install = installProactiveAuthFetch();
      expect(install.pristineFetch).not.toBe(globalThis.fetch); // not the patched global
    } finally {
      globalThis.fetch = original;
    }
  });
});
