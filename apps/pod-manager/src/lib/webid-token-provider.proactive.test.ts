/**
 * PROACTIVE background refresh of the local `WebIdDPoPTokenProvider` port.
 *
 * The lazy paths renew only after a token is already stale (upgrade()-on-expiry,
 * renew-on-rejected-401). Proactive refresh runs the refresh-token grant in the
 * BACKGROUND before expiry so a long import / idle→active session never hits an
 * expired token mid-flow. These tests drive it with vitest fake timers and an
 * injected visibility lifecycle, asserting:
 *   - a refresh fires before expiry with NO upgrade()/401 (grant_type=refresh_token,
 *     getCode never called), and reschedules from the ROTATED token;
 *   - a hidden tab does NOT fire the timer; visibility→visible near/after expiry
 *     refreshes immediately;
 *   - logout + teardown clear timers (no refresh after);
 *   - invalid_grant stops scheduling and opens NO window;
 *   - transient failure retries with bounded backoff;
 *   - a no-refresh-token issuer schedules nothing.
 *
 * MIRRORS-CANDIDATE: this is the upstream-port test surface for the proactive
 * scheduler described in webid-token-provider.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WebIdDPoPTokenProvider,
  type VisibilityLifecycle,
} from "./webid-token-provider";
import {
  createFakeAuthorizationServer,
  type FakeAuthorizationServer,
} from "./test-utils/fake-authorization-server";

const WEBID = "https://pod.test/profile/card#me";
const CALLBACK = "https://app.test/callback.html";
const CLIENT_ID = "https://app.test/clientid.jsonld";
const ISSUER = new URL("https://as.test");

const profileTurtle = `<${WEBID}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://as.test> .`;
const profileFetch: typeof fetch = async () =>
  new Response(profileTurtle, {
    status: 200,
    headers: { "content-type": "text/turtle" },
  });

let as: FakeAuthorizationServer;

/** A controllable Page Visibility surface; tests flip visibility and emit. */
class FakeVisibility implements VisibilityLifecycle {
  visible = true;
  #resume = new Set<() => void>();
  #hide = new Set<() => void>();

  isVisible(): boolean {
    return this.visible;
  }
  onResume(listener: () => void): () => void {
    this.#resume.add(listener);
    return () => this.#resume.delete(listener);
  }
  onHide(listener: () => void): () => void {
    this.#hide.add(listener);
    return () => this.#hide.delete(listener);
  }
  /** Listener counts so a test can assert teardown released them. */
  get listenerCount(): number {
    return this.#resume.size + this.#hide.size;
  }
  hide(): void {
    this.visible = false;
    for (const l of [...this.#hide]) l();
  }
  show(): void {
    this.visible = true;
    for (const l of [...this.#resume]) l();
  }
}

interface Harness {
  provider: WebIdDPoPTokenProvider;
  getCode: ReturnType<typeof vi.fn>;
  visibility: FakeVisibility;
}

/**
 * Build a proactive-enabled provider. `setTimeoutFn`/`clearTimeoutFn` bind to
 * the (faked) globals so vitest's `advanceTimersByTime` drives the scheduler.
 */
/** Every provider built this run — torn down in afterEach (see below). */
const providers: WebIdDPoPTokenProvider[] = [];

function makeProvider(visibility = new FakeVisibility()): Harness {
  const getCode = vi.fn((url: URL) => as.authorize(url));
  const provider = new WebIdDPoPTokenProvider(CALLBACK, getCode, async () => WEBID, {
    clientId: CLIENT_ID,
    profileFetch,
    proactiveRefresh: true,
    visibilityLifecycle: visibility,
    setTimeoutFn: (h, ms) => setTimeout(h, ms),
    clearTimeoutFn: (t) => clearTimeout(t),
  });
  providers.push(provider);
  return { provider, getCode, visibility };
}

/** Short-lived tokens so the proactive timer fires within the fake clock. */
async function shortLivedAs(expiresIn = 120): Promise<FakeAuthorizationServer> {
  return createFakeAuthorizationServer({
    expiresIn,
    issueRefreshTokens: true,
    scopesSupported: ["openid", "webid", "offline_access"],
    grantTypesSupported: ["authorization_code", "refresh_token"],
    webIdClaim: WEBID,
  });
}

const refreshGrants = () =>
  as.tokenRequests.filter((r) => r.get("grant_type") === "refresh_token");

/**
 * Advance the fake clock (draining a few extra microtask rounds). This moves
 * TIME but cannot guarantee the refresh chain it kicks off has SETTLED: the
 * chain interleaves fake-timer hops with REAL async work — ES256 DPoP signing
 * and JWT verification run on Node's WebCrypto threadpool in wall-clock time,
 * which no amount of fake-clock advancement flushes. Positive assertions must
 * follow {@link settleRefreshGrants}; `tick` alone is only sound for NEGATIVE
 * assertions (nothing armed → nothing to settle).
 */
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
}

/**
 * Deterministically wait until exactly `count` refresh grants have landed at
 * the fake AS. `vi.waitFor` polls in REAL time — so the chain's WebCrypto work
 * completes between attempts regardless of machine speed — while auto-advancing
 * the fake clock by its interval each attempt (vitest's documented fake-timer
 * integration), so a near-due re-armed timer still fires without real sleeps.
 *
 * This replaced a fixed-count microtask drain that was machine-speed-dependent:
 * fast locally, but on slower CI runners the crypto had not landed within the
 * fixed rounds — the test observed 0 grants, and the still-in-flight chain then
 * leaked its token request onto the NEXT test's fresh AS (global fetch is
 * re-stubbed per test; oauth4webapi resolves `fetch` at call time).
 */
async function settleRefreshGrants(count: number): Promise<void> {
  await vi.waitFor(() => expect(refreshGrants()).toHaveLength(count), {
    timeout: 10_000,
  });
}

beforeEach(async () => {
  as = await shortLivedAs();
  vi.stubGlobal("fetch", as.fetch);
});

afterEach(() => {
  // Tear down every provider FIRST (idempotent): #destroyed stops any late
  // rescheduling, so a chain that outlives its test cannot arm new cycles
  // against the next test's fake AS. (Each test also settles its own chain via
  // settleRefreshGrants before asserting — teardown is defence-in-depth.)
  for (const provider of providers.splice(0)) provider.teardown();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("proactive refresh: scheduling", () => {
  it("refreshes BEFORE expiry with no upgrade()/401 — getCode never re-fires, grant is refresh_token", async () => {
    vi.useFakeTimers();
    const { provider, getCode } = makeProvider();

    await provider.login(ISSUER);
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(refreshGrants()).toHaveLength(0);

    // Lifetime 120s, skew 30s → expiresAt 90s out; schedule fires at lead 30s
    // (≈60s). Advance past it WITHOUT any upgrade()/invalidate().
    await tick(65_000);

    // A proactive refresh ran purely from the timer — exactly one, and stable.
    await settleRefreshGrants(1);
    await tick(0);
    expect(refreshGrants()).toHaveLength(1);
    expect(getCode).toHaveBeenCalledTimes(1); // no popup/authorize
    expect(as.tokenRequests.at(-1)?.get("grant_type")).toBe("refresh_token");
  });

  it("reschedules from the ROTATED token — a second cycle fires with a new refresh_token", async () => {
    vi.useFakeTimers();
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER);

    await tick(65_000); // cycle 1
    await settleRefreshGrants(1);

    await tick(65_000); // cycle 2 (from rotated token)
    await settleRefreshGrants(2);
    const grants = refreshGrants();
    expect(grants[1]?.get("refresh_token")).not.toBe(grants[0]?.get("refresh_token"));
    expect(getCode).toHaveBeenCalledTimes(1); // still never a popup
  });

  it("a proactive refresh in flight satisfies a concurrent upgrade() (single-flight, no stampede)", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider();
    await provider.login(ISSUER);

    await tick(65_000);
    await settleRefreshGrants(1);
    const grantsAfterProactive = refreshGrants().length;
    expect(grantsAfterProactive).toBe(1);

    // The session is fresh again; an upgrade() now must NOT trigger another grant.
    const upgraded = await provider.upgrade(new Request("https://pod.test/x"));
    expect(upgraded.headers.get("Authorization")).toMatch(/^DPoP at-\d+$/);
    expect(refreshGrants()).toHaveLength(grantsAfterProactive);
  });

  it("a proactive fire that races an IN-FLIGHT lazy renewal joins it — exactly one grant", async () => {
    // Gate the token endpoint to hold a lazy renewal in-flight, then fire the
    // proactive timer into the same window: the two MUST share the single
    // refresh grant (single-flight, no stampede). The gate's "parked" promise
    // pins the ordering (the lazy grant is provably in #sessions before the
    // proactive timer runs), so this is deterministic regardless of run order.
    vi.useFakeTimers();
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER);
    expect(refreshGrants()).toHaveLength(0);

    const realFetch = as.fetch;
    let releaseToken: () => void = () => {};
    const tokenGate = new Promise<void>((r) => {
      releaseToken = r;
    });
    let signalParked: () => void = () => {};
    const parked = new Promise<void>((r) => {
      signalParked = r;
    });
    let gated = true;
    vi.stubGlobal("fetch", (async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (gated && url.endsWith("/token")) {
        gated = false;
        signalParked(); // a refresh grant has reached the endpoint and is held
        await tokenGate;
      }
      return realFetch(input, init);
    }) as typeof fetch);

    // Force the cached session stale and start a LAZY renewal; it reaches the
    // token endpoint and PARKS on the gate. `await parked` guarantees its
    // #begin has populated #sessions before the proactive timer fires below.
    await provider.invalidate(
      await provider.upgrade(new Request("https://pod.test/x")),
    );
    const lazy = provider.upgrade(new Request("https://pod.test/y"));
    await parked;

    // Fire the proactive timer NOW, with the lazy grant provably in flight. It
    // reads the in-flight #sessions entry and must JOIN it — not start a 2nd.
    await vi.advanceTimersByTimeAsync(65_000);

    releaseToken(); // release the single in-flight grant
    await lazy;
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);

    expect(refreshGrants()).toHaveLength(1); // ONE grant shared by both paths
    expect(getCode).toHaveBeenCalledTimes(1); // and never a popup
  });

  it("schedules nothing for an issuer that got no refresh token (N/A — lazy path only)", async () => {
    as = await createFakeAuthorizationServer({
      expiresIn: 120,
      scopesSupported: ["openid", "webid"], // no offline_access → no refresh token
      webIdClaim: WEBID,
    });
    vi.stubGlobal("fetch", as.fetch);
    vi.useFakeTimers();
    const { provider, getCode } = makeProvider();

    await provider.login(ISSUER);
    await tick(10 * 60_000);

    expect(refreshGrants()).toHaveLength(0); // nothing scheduled
    expect(getCode).toHaveBeenCalledTimes(1);
  });
});

describe("proactive refresh: visibility lifecycle", () => {
  it("a hidden tab does NOT fire the timer", async () => {
    vi.useFakeTimers();
    const visibility = new FakeVisibility();
    const { provider } = makeProvider(visibility);
    await provider.login(ISSUER);

    visibility.hide(); // backgrounded before the timer would fire
    await tick(10 * 60_000); // well past any fire point

    expect(refreshGrants()).toHaveLength(0); // no churn while hidden
  });

  it("visibility→visible while past the refresh window refreshes IMMEDIATELY", async () => {
    vi.useFakeTimers();
    const visibility = new FakeVisibility();
    const { provider, getCode } = makeProvider(visibility);
    await provider.login(ISSUER);

    visibility.hide();
    await tick(10 * 60_000); // timer dropped while hidden
    expect(refreshGrants()).toHaveLength(0);

    // Returning to the tab: ALWAYS re-evaluate expiry (don't trust the timer).
    visibility.show();
    await settleRefreshGrants(1); // the immediate refresh settles (real time)
    expect(getCode).toHaveBeenCalledTimes(1); // no popup on resume
  });

  it("visibility→visible BEFORE the window re-arms a timer rather than refreshing now", async () => {
    vi.useFakeTimers();
    const visibility = new FakeVisibility();
    const { provider } = makeProvider(visibility);
    await provider.login(ISSUER);

    visibility.hide();
    await tick(5_000); // still far from the fire point
    visibility.show();
    await tick(0);
    expect(refreshGrants()).toHaveLength(0); // not yet — re-armed, not fired

    await tick(60_000); // now reach the window
    await settleRefreshGrants(1);
  });
});

describe("proactive refresh: teardown & logout", () => {
  it("teardown() clears timers AND releases the visibility listeners (no refresh after)", async () => {
    vi.useFakeTimers();
    const visibility = new FakeVisibility();
    const { provider } = makeProvider(visibility);
    await provider.login(ISSUER);
    expect(visibility.listenerCount).toBeGreaterThan(0);

    provider.teardown();
    expect(visibility.listenerCount).toBe(0);

    await tick(10 * 60_000);
    expect(refreshGrants()).toHaveLength(0); // no refresh after teardown
  });

  it("forgetPersisted() (logout) stops scheduling — no refresh after logout", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider();
    await provider.login(ISSUER);

    await provider.forgetPersisted(ISSUER); // logout
    await tick(10 * 60_000);

    expect(refreshGrants()).toHaveLength(0);
  });

  it("stopProactiveRefresh() halts an issuer's cycle without touching the session", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider();
    await provider.login(ISSUER);

    provider.stopProactiveRefresh(ISSUER);
    await tick(10 * 60_000);
    expect(refreshGrants()).toHaveLength(0);
  });
});

describe("proactive refresh: failure handling", () => {
  it("invalid_grant stops scheduling and opens NO window", async () => {
    vi.useFakeTimers();
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER);

    as.activeRefreshTokens.clear(); // revoked → invalid_grant on the proactive grant

    await tick(65_000); // the proactive refresh fires & fails
    await settleRefreshGrants(1); // it tried exactly once
    expect(getCode).toHaveBeenCalledTimes(1); // and crucially NO popup/authorize

    // Scheduling STOPPED: no further attempts no matter how long we wait.
    await tick(10 * 60_000);
    expect(refreshGrants()).toHaveLength(1);
    expect(getCode).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure with bounded backoff, still no popup", async () => {
    vi.useFakeTimers();
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER);

    // Make the NEXT few token-endpoint calls fail with a network error, then heal.
    const realFetch = as.fetch;
    let failures = 2; // two transient failures, then success
    vi.stubGlobal("fetch", ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (failures > 0 && url.endsWith("/token")) {
        failures--;
        return Promise.reject(new TypeError("network down"));
      }
      return realFetch(input, init);
    }) as typeof fetch);

    await tick(65_000); // the first proactive attempt fires
    // Drive the retry cycle (2s then 4s backoff) to completion. How much of the
    // cascade already ran inside the tick above is machine-speed-dependent (each
    // attempt needs REAL time for its DPoP signing before it can reject), so no
    // intermediate state is asserted — advance the fake clock in 1s hops, with
    // real time between attempts for the chain's WebCrypto work, until the
    // healed attempt lands. Exactly one grant reaches the AS (the rejected
    // attempts never got past the stub) and no popup throughout.
    await vi.waitFor(
      async () => {
        await vi.advanceTimersByTimeAsync(1_000);
        expect(failures).toBe(0);
        expect(refreshGrants()).toHaveLength(1);
      },
      { timeout: 10_000 },
    );
    expect(getCode).toHaveBeenCalledTimes(1);
  });

  it("gives up after the bounded retry budget (no infinite loop, no popup)", async () => {
    vi.useFakeTimers();
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER);

    // Permanently transient: every token call rejects.
    const realFetch = as.fetch;
    vi.stubGlobal("fetch", ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/token")) return Promise.reject(new TypeError("network down"));
      return realFetch(input, init);
    }) as typeof fetch);

    await tick(65_000); // attempt 1
    await tick(60_000); // burn all backoff windows
    const attempts = refreshGrants().length;

    await tick(10 * 60_000); // long after the budget
    expect(refreshGrants().length).toBe(attempts); // stopped — bounded
    expect(getCode).toHaveBeenCalledTimes(1); // never a popup
  });
});
