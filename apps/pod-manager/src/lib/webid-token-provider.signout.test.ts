// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Sign-out and account-switch fencing for `WebIdDPoPTokenProvider`
 * (sst-8xm.6). A login, lazy refresh, proactive refresh or restore that is
 * still in flight when the user signs out must not publish, persist or
 * reschedule its session afterwards, and a same-issuer account switch must
 * never hand back the previous account's tokens.
 *
 * Deferred network, store and signing operations make sign-out boundaries
 * deterministic without relying on elapsed time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeAuthorizationServer,
  type FakeAuthorizationServerOptions,
  createFakeAuthorizationServer,
} from "./test-utils/fake-authorization-server";
import { loginProfile, WebIdIssuerAuthorityError } from "./session-identity";
import { StructuredCloneSessionStore } from "./test-utils/structured-clone-session-store";
import {
  IssuerForgottenError,
  SessionIdentityChangedError,
  type VisibilityLifecycle,
  WebIdDPoPTokenProvider,
  type WebIdDPoPTokenProviderOptions,
} from "./webid-token-provider";

const ALICE = "https://pod.test/alice/profile/card#me";
const BOB = "https://pod.test/bob/profile/card#me";
const CALLBACK = "https://app.test/callback.html";
const CLIENT_ID = "https://app.test/clientid.jsonld";
const ISSUER = new URL("https://as.test");

const profileFetch: typeof fetch = async () =>
  new Response(`<${ALICE}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://as.test> .`, {
    status: 200,
    headers: { "content-type": "text/turtle" },
  });

const visible: VisibilityLifecycle = {
  isVisible: () => true,
  onResume: () => () => {},
  onHide: () => () => {},
};

let asOptions: FakeAuthorizationServerOptions;
let as: FakeAuthorizationServer;
let store: StructuredCloneSessionStore;
const providers: WebIdDPoPTokenProvider[] = [];

/** The resolved-or-pending state of the one token request being held. */
interface Hold {
  /** Resolves once the held token request has reached the fake AS. */
  arrived: Promise<void>;
  /** Lets the held request through to the fake AS. */
  release(): void;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function holdOperation() {
  const arrived = deferred<void>();
  const released = deferred<void>();
  return {
    arrived: arrived.promise,
    release: () => released.resolve(),
    async wait() { arrived.resolve(); await released.promise; },
  };
}

function holdStore(method: "get" | "put" | "delete") {
  const hold = holdOperation();
  if (method === "get") {
    const get = store.get.bind(store);
    vi.spyOn(store, "get").mockImplementationOnce(async (issuer) => {
      const snapshot = await get(issuer);
      await hold.wait();
      return snapshot;
    });
  } else if (method === "put") {
    const put = store.put.bind(store);
    vi.spyOn(store, "put").mockImplementationOnce(async (session) => {
      await hold.wait();
      await put(session);
    });
  } else {
    const remove = store.delete.bind(store);
    vi.spyOn(store, "delete").mockImplementationOnce(async (issuer) => {
      await hold.wait();
      await remove(issuer);
    });
  }
  return hold;
}

function holdNextDiscovery() {
  const hold = holdOperation();
  let armed = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (armed && new URL(request.url).pathname === "/.well-known/openid-configuration") {
      armed = false;
      await hold.wait();
    }
    return as.fetch(request);
  });
  return hold;
}

function holdNextProof() {
  const hold = holdOperation();
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "sign").mockImplementationOnce(async (...args) => {
    await hold.wait();
    return sign(...args);
  });
  return hold;
}

/** Hold the NEXT token-endpoint request until `release()` is called. */
function holdNextTokenRequest(): Hold {
  let release!: () => void;
  let arrive!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let armed = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (armed && request.method === "POST" && new URL(request.url).pathname === "/token") {
      armed = false;
      arrive();
      await released;
    }
    return as.fetch(request);
  });
  return { arrived, release };
}

function makeProvider(options: WebIdDPoPTokenProviderOptions & {
  proactive?: boolean;
  getWebId?: () => Promise<string>;
  getCode?: (url: URL, signal: AbortSignal) => Promise<string>;
} = {}) {
  const getCode = vi.fn(options.getCode ?? ((url: URL) => as.authorize(url)));
  const provider = new WebIdDPoPTokenProvider(
    CALLBACK,
    getCode,
    options.getWebId ?? (async () => ALICE),
    {
      clientId: CLIENT_ID,
      profileFetch,
      sessionStore: store,
      ...options,
      ...(options.proactive === true
        ? {
            proactiveRefresh: true,
            visibilityLifecycle: options.visibilityLifecycle ?? visible,
            setTimeoutFn: (h: () => void, ms: number) => setTimeout(h, ms),
            clearTimeoutFn: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
          }
        : {}),
    },
  );
  providers.push(provider);
  return { provider, getCode };
}

const refreshGrants = () =>
  as.tokenRequests.filter((r) => r.get("grant_type") === "refresh_token");

beforeEach(async () => {
  asOptions = {
    expiresIn: 120,
    issueRefreshTokens: true,
    scopesSupported: ["openid", "webid", "offline_access"],
    grantTypesSupported: ["authorization_code", "refresh_token"],
    webIdClaim: ALICE,
  };
  as = await createFakeAuthorizationServer(asOptions);
  store = new StructuredCloneSessionStore();
  vi.stubGlobal("fetch", as.fetch);
});

afterEach(() => {
  for (const provider of providers.splice(0)) provider.teardown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("forgetIssuer (sign-out)", () => {
  it("drops the in-memory session: the next login runs the code flow again", async () => {
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER);
    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(true);

    await provider.forgetIssuer(ISSUER);

    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(false);
    await provider.login(ISSUER);
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it("unpins the issuer, so a later 401 upgrade does not reuse the signed-out session", async () => {
    const getWebId = vi.fn(async () => ALICE);
    const { provider, getCode } = makeProvider({ getWebId });
    await provider.login(ISSUER);
    await provider.forgetIssuer(ISSUER);

    getWebId.mockRejectedValueOnce(new Error("No WebID provided for login"));
    await expect(provider.upgrade(new Request("https://pod.test/private"))).rejects.toThrow(
      "No WebID provided for login",
    );
    expect(getCode).toHaveBeenCalledTimes(1);
  });

  it("a lazy refresh in flight at sign-out is discarded, not cached or persisted", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER);
    expect(store.peek(ISSUER.href)).toBeDefined();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000); // the access token has expired
    const hold = holdNextTokenRequest();
    const upgrade = provider.upgrade(new Request("https://pod.test/private"));
    await hold.arrived; // the refresh grant is at the token endpoint

    await provider.forgetIssuer(ISSUER);
    hold.release();

    await expect(upgrade).rejects.toBeInstanceOf(IssuerForgottenError);
    expect(refreshGrants()).toHaveLength(1);
    expect(store.peek(ISSUER.href)).toBeUndefined();
    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(false);
  });

  it("a proactive refresh in flight at sign-out does not revive the session", async () => {
    const settled = deferred<string>();
    const unsubResume = vi.fn();
    const unsubHide = vi.fn();
    const { provider } = makeProvider({
      proactive: true,
      visibilityLifecycle: {
        isVisible: () => true,
        onResume: () => unsubResume,
        onHide: () => unsubHide,
      },
      onProactiveRefreshSettled: (_issuer, outcome) => settled.resolve(outcome),
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await provider.login(ISSUER);
    expect(store.puts).toHaveLength(1);

    const hold = holdNextTokenRequest();
    await vi.advanceTimersByTimeAsync(120_000); // fire the proactive timer
    await hold.arrived; // the proactive refresh grant is at the token endpoint

    await provider.forgetIssuer(ISSUER);
    hold.release();
    expect(await settled.promise).toBe("forgotten");

    expect(store.puts).toHaveLength(1);
    expect(store.peek(ISSUER.href)).toBeUndefined();
    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(unsubResume).toHaveBeenCalledOnce();
    expect(unsubHide).toHaveBeenCalledOnce();
  });

  it("a restore in flight at sign-out leaves nothing persisted", async () => {
    const { provider: first } = makeProvider();
    await first.login(ISSUER);
    const { provider: reloaded } = makeProvider();

    const hold = holdNextTokenRequest();
    const restore = reloaded.restoreIssuer(ISSUER);
    await hold.arrived;
    await reloaded.forgetIssuer(ISSUER);
    hold.release();

    expect(await restore).toBeUndefined();
    expect(store.peek(ISSUER.href)).toBeUndefined();
    expect(reloaded.canRenewWithoutInteraction(ISSUER)).toBe(false);
  });

  it("a forgotten refresh failing with invalid_grant does not clear a newer login", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000);
    const hold = holdNextTokenRequest();
    const stale = provider.upgrade(new Request("https://pod.test/private"));
    await hold.arrived;
    await provider.forgetIssuer(ISSUER);
    as.activeRefreshTokens.clear(); // the old refresh token is now dead

    await provider.login(ISSUER); // a new sign-in completes first
    hold.release();
    await expect(stale).rejects.toBeInstanceOf(IssuerForgottenError);

    expect(store.peek(ISSUER.href)).toBeDefined();
    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(true);
  });
});

describe("same-issuer account switch", () => {
  it("login with a different expectedWebId runs the code flow instead of reusing the cached session", async () => {
    const { provider, getCode } = makeProvider();
    const first = await provider.login(ISSUER, { expectedWebId: ALICE });
    expect(first.webId).toBe(ALICE);

    asOptions.webIdClaim = BOB; // Bob signs in at the same IdP
    const second = await provider.login(ISSUER, { expectedWebId: BOB });

    expect(getCode).toHaveBeenCalledTimes(2);
    expect(second.webId).toBe(BOB);
    expect(store.peek(ISSUER.href)?.webId).toBe(BOB);
  });

  it("the popup probe says no when the cached session belongs to another WebID", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER, { expectedWebId: ALICE });

    expect(provider.canRenewWithoutInteraction(ISSUER, ALICE)).toBe(true);
    expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(false);
    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(true);
  });

  it("login with the same expectedWebId still reuses the cached session", async () => {
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER, { expectedWebId: ALICE });
    await provider.login(ISSUER, { expectedWebId: ALICE });
    expect(getCode).toHaveBeenCalledTimes(1);
  });
});

describe("adversarial sign-out boundaries", () => {
  it("matching pending owners share one authentication flow", async () => {
    const { provider, getCode } = makeProvider();
    const hold = holdNextTokenRequest();
    const first = provider.login(ISSUER, { expectedWebId: ALICE });
    await hold.arrived;
    const joined = provider.login(ISSUER, { expectedWebId: ALICE });
    hold.release();
    expect(await first).toMatchObject({ webId: ALICE });
    expect(await joined).toMatchObject({ webId: ALICE });
    expect(getCode).toHaveBeenCalledTimes(1);
  });

  it("joined upgrades reject the same forgotten login as its initiating caller", async () => {
    const { provider } = makeProvider();
    const hold = holdNextTokenRequest();
    const login = provider.login(ISSUER).catch((e: unknown) => e);
    await hold.arrived;
    const upgrade = provider.upgrade(new Request("https://pod.test/private")).catch((e: unknown) => e);
    // Let upgrade join the cached promise before sign-out.
    await Promise.resolve();
    await provider.forgetIssuer(ISSUER);
    hold.release();
    expect(await login).toBeInstanceOf(IssuerForgottenError);
    expect(await upgrade).toBeInstanceOf(IssuerForgottenError);
  });

  it("an expired cached waiter cannot renew under the post-logout generation", async () => {
    const { provider, getCode } = makeProvider();
    const hold = holdStore("put");
    const login = provider.login(ISSUER).catch((e: unknown) => e);
    await hold.arrived;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 121_000);
    const upgrade = provider.upgrade(new Request("https://pod.test/private")).catch((e: unknown) => e);
    await Promise.resolve();
    const logout = provider.forgetIssuer(ISSUER);
    hold.release();
    await logout;
    expect(await login).toBeInstanceOf(IssuerForgottenError);
    expect(await upgrade).toBeInstanceOf(IssuerForgottenError);
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(refreshGrants()).toHaveLength(0);
  });

  it("logout during DPoP signing cannot release a forgotten token", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER);
    const hold = holdNextProof();
    const upgrade = provider.upgrade(new Request("https://pod.test/private")).catch((e: unknown) => e);
    await hold.arrived;
    await provider.forgetIssuer(ISSUER);
    hold.release();
    expect(await upgrade).toBeInstanceOf(IssuerForgottenError);
  });

  it("a delayed store snapshot cannot restore after logout", async () => {
    const { provider: first } = makeProvider();
    await first.login(ISSUER);
    const { provider } = makeProvider();
    const hold = holdStore("get");
    const restore = provider.restoreIssuer(ISSUER);
    await hold.arrived;
    const logout = provider.forgetIssuer(ISSUER);
    hold.release();
    await logout;
    expect(await restore).toBeUndefined();
    expect(refreshGrants()).toHaveLength(0);
    expect(store.peek(ISSUER.href)).toBeUndefined();
  });

  it("restore never replaces a newer in-memory login after a delayed store read", async () => {
    const { provider: first } = makeProvider();
    await first.login(ISSUER);
    const { provider } = makeProvider();
    const hold = holdStore("get");
    const restore = provider.restoreIssuer(ISSUER);
    await hold.arrived;
    asOptions.webIdClaim = BOB;
    const bob = provider.login(ISSUER, { expectedWebId: BOB });
    hold.release();
    await bob;
    expect(await restore).toBeUndefined();
    expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(true);
    expect(store.peek(ISSUER.href)?.webId).toBe(BOB);
    expect(refreshGrants()).toHaveLength(0);
  });

  it("restore leaves an existing in-flight login untouched", async () => {
    const { provider: first } = makeProvider();
    await first.login(ISSUER);
    const { provider } = makeProvider();
    const hold = holdNextTokenRequest();
    asOptions.webIdClaim = BOB;
    const login = provider.login(ISSUER, { expectedWebId: BOB });
    await hold.arrived;
    expect(await provider.restoreIssuer(ISSUER)).toBeUndefined();
    hold.release();
    expect((await login).webId).toBe(BOB);
    expect(refreshGrants()).toHaveLength(0);
  });

  it("logout invalidates pending profile resolution before it can pin or authenticate", async () => {
    const hold = holdOperation();
    const getWebId = vi.fn(async () => ALICE);
    const { provider, getCode } = makeProvider({
      getWebId,
      profileFetch: async (...args) => { await hold.wait(); return profileFetch(...args); },
    });
    const upgrade = provider.upgrade(new Request("https://pod.test/private")).catch((e: unknown) => e);
    await hold.arrived;
    await provider.forgetIssuer(ISSUER);
    hold.release();
    expect(await upgrade).toBeInstanceOf(IssuerForgottenError);
    expect(getCode).not.toHaveBeenCalled();
    getWebId.mockRejectedValueOnce(new Error("must resolve again"));
    await expect(provider.upgrade(new Request("https://pod.test/private"))).rejects.toThrow("must resolve again");
  });

  it("forgetting another issuer also fences an upgrade paused in proof signing", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER);
    const hold = holdNextProof();
    const upgrade = provider.upgrade(new Request("https://pod.test/private")).catch((e: unknown) => e);
    await hold.arrived;
    await provider.forgetIssuer(new URL("https://other.test"));
    hold.release();
    expect(await upgrade).toBeInstanceOf(IssuerForgottenError);
  });

  it("a different expected account replaces a pending login instead of joining it", async () => {
    const { provider, getCode } = makeProvider();
    const hold = holdNextTokenRequest();
    const alice = provider.login(ISSUER, { expectedWebId: ALICE }).catch((e: unknown) => e);
    await hold.arrived;
    asOptions.webIdClaim = BOB;
    const bob = provider.login(ISSUER, { expectedWebId: BOB });
    // Releasing Alice also makes the unfixed shared-promise path settle.
    hold.release();
    expect((await bob).webId).toBe(BOB);
    expect(await alice).toBeInstanceOf(IssuerForgottenError);
    expect(getCode).toHaveBeenCalledTimes(2);
    expect(store.peek(ISSUER.href)?.webId).toBe(BOB);
  });

  it("an unknown settled WebID cannot satisfy an explicit account login or popup probe", async () => {
    asOptions.webIdClaim = undefined;
    const { provider, getCode } = makeProvider();
    expect((await provider.login(ISSUER)).webId).toBeUndefined();
    expect(provider.canRenewWithoutInteraction(ISSUER, ALICE)).toBe(false);
    asOptions.webIdClaim = ALICE;
    expect((await provider.login(ISSUER, { expectedWebId: ALICE })).webId).toBe(ALICE);
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it("a held put followed by two logouts cannot revive either account", async () => {
    const { provider } = makeProvider();
    const hold = holdStore("put");
    const alice = provider.login(ISSUER, { expectedWebId: ALICE }).catch((e: unknown) => e);
    await hold.arrived;
    const logoutAlice = provider.forgetIssuer(ISSUER);
    asOptions.webIdClaim = BOB;
    const bob = provider.login(ISSUER, { expectedWebId: BOB }).catch((e: unknown) => e);
    await vi.waitFor(() => expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(true));
    const logoutBob = provider.forgetIssuer(ISSUER);
    // Deletes and newer puts must wait for the older write to finish.
    const deletesBeforeRelease = store.deletes.length;
    const putsBeforeRelease = store.puts.length;
    hold.release();
    await Promise.all([alice, bob, logoutAlice, logoutBob]);
    expect(deletesBeforeRelease).toBe(0);
    expect(putsBeforeRelease).toBe(0);
    expect(store.puts.map((session) => session.webId)).toEqual([ALICE]);
    expect(store.peek(ISSUER.href)).toBeUndefined();
    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(false);
  });

  it("a held logout delete finishes before a newer login is persisted", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER);
    const hold = holdStore("delete");
    const logout = provider.forgetIssuer(ISSUER);
    await hold.arrived;
    asOptions.webIdClaim = BOB;
    const bob = provider.login(ISSUER, { expectedWebId: BOB });
    await vi.waitFor(() => expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(true));
    hold.release();
    await Promise.all([bob, logout]);
    expect(store.peek(ISSUER.href)?.webId).toBe(BOB);
  });

  it("logout aborts discovery and never opens the authorization popup", async () => {
    const { provider, getCode } = makeProvider();
    const hold = holdNextDiscovery();
    const login = provider.login(ISSUER).catch((e: unknown) => e);
    await hold.arrived;
    await provider.forgetIssuer(ISSUER);
    hold.release();
    expect(await login).toBeInstanceOf(IssuerForgottenError);
    expect(getCode).not.toHaveBeenCalled();
  });

  it("logout aborts a waiting authorization callback with IssuerForgottenError", async () => {
    const arrived = deferred<void>();
    const { provider } = makeProvider({ getCode: async (_url, signal) => {
      arrived.resolve();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    } });
    const login = provider.login(ISSUER).catch((e: unknown) => e);
    await arrived.promise;
    await provider.forgetIssuer(ISSUER);
    expect(await login).toBeInstanceOf(IssuerForgottenError);
  });

  it.each(["error", "non-callback"])("logout prevents interactive retry after a delayed silent %s response", async (shape) => {
    const hold = holdOperation();
    const { provider, getCode } = makeProvider({ getCode: async (url) => {
      await hold.wait();
      if (shape === "non-callback") return "https://as.test/login";
      const callback = new URL(CALLBACK);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("error", "login_required");
      return callback.href;
    } });
    const login = provider.login(ISSUER, { silentFirst: true }).catch((e: unknown) => e);
    await hold.arrived;
    const signal = getCode.mock.calls[0][1];
    await provider.forgetIssuer(ISSUER);
    hold.release();
    expect(await login).toBeInstanceOf(IssuerForgottenError);
    expect(signal.aborted).toBe(true);
    expect(getCode).toHaveBeenCalledTimes(1);
  });
});

describe("round 3 ownership regressions", () => {
  it("pending owner wins over a retained settled snapshot", async () => {
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER, { expectedWebId: ALICE });
    await provider.invalidate(await provider.upgrade(new Request("https://pod.test/x")));
    as.activeRefreshTokens.clear();
    getCode.mockRejectedValueOnce(new Error("cancelled"));
    await expect(provider.upgrade(new Request("https://pod.test/x"))).rejects.toThrow("cancelled");
    asOptions.webIdClaim = BOB;
    const hold = holdNextTokenRequest();
    const bob = provider.login(ISSUER).catch((e: unknown) => e);
    await hold.arrived;
    asOptions.webIdClaim = ALICE;
    const alice = provider.login(ISSUER, { expectedWebId: ALICE });
    hold.release();
    expect((await alice).webId).toBe(ALICE);
    expect(await bob).toBeInstanceOf(IssuerForgottenError);
    expect(getCode).toHaveBeenCalledTimes(4);
  });

  it("renewal inherits its confirmed owner for explicit matching joins", async () => {
    const { provider, getCode } = makeProvider();
    await provider.login(ISSUER);
    await provider.invalidate(await provider.upgrade(new Request("https://pod.test/x")));
    const hold = holdNextTokenRequest();
    const renewal = provider.upgrade(new Request("https://pod.test/x")).catch((e: unknown) => e);
    await hold.arrived;
    const login = provider.login(ISSUER, { expectedWebId: ALICE });
    hold.release();
    expect((await login).webId).toBe(ALICE);
    await renewal;
    expect(refreshGrants()).toHaveLength(1);
    expect(getCode).toHaveBeenCalledTimes(1);
  });

  it("explicit login invalidates pending issuer resolution", async () => {
    const hold = holdOperation();
    const { provider, getCode } = makeProvider({
      profileFetch: async (...args) => { await hold.wait(); return profileFetch(...args); },
    });
    const upgrade = provider.upgrade(new Request("https://pod.test/x")).catch((e: unknown) => e);
    await hold.arrived;
    asOptions.webIdClaim = BOB;
    await provider.login(ISSUER, { expectedWebId: BOB });
    hold.release();
    expect(await upgrade).toBeInstanceOf(IssuerForgottenError);
    expect(getCode).toHaveBeenCalledTimes(1);
    expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(true);
  });

  it.each([BOB, undefined])("background reauthentication rejects account drift (%s)", async (claim) => {
    const { provider } = makeProvider();
    await provider.login(ISSUER);
    const previous = store.peek(ISSUER.href);
    await provider.invalidate(await provider.upgrade(new Request("https://pod.test/x")));
    as.activeRefreshTokens.clear();
    asOptions.webIdClaim = claim;
    await expect(provider.upgrade(new Request("https://pod.test/x"))).rejects.toThrow(SessionIdentityChangedError);
    expect(store.peek(ISSUER.href)).toEqual(previous);
    expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(false);
    await expect(provider.upgrade(new Request("https://pod.test/x"))).rejects.toThrow(SessionIdentityChangedError);
    expect(store.peek(ISSUER.href)).toEqual(previous);
    if (claim === BOB) expect((await provider.login(ISSUER, { expectedWebId: BOB })).webId).toBe(BOB);
  });

  it("restore reads after an earlier queued logout deletion", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER);
    const hold = holdStore("delete");
    const logout = provider.forgetIssuer(ISSUER);
    await hold.arrived;
    const restore = provider.restoreIssuer(ISSUER);
    hold.release();
    await logout;
    expect(await restore).toBeUndefined();
    expect(refreshGrants()).toHaveLength(0);
    expect(store.peek(ISSUER.href)).toBeUndefined();
  });

  it("account switch deletes durable Alice when Bob gets no refresh token", async () => {
    const { provider } = makeProvider();
    await provider.login(ISSUER, { expectedWebId: ALICE });
    as = await createFakeAuthorizationServer({ webIdClaim: BOB, expiresIn: 120 });
    vi.stubGlobal("fetch", as.fetch);
    expect((await provider.login(ISSUER, { expectedWebId: BOB })).webId).toBe(BOB);
    expect(store.peek(ISSUER.href)).toBeUndefined();
    const { provider: reloaded } = makeProvider();
    expect(await reloaded.restoreIssuer(ISSUER)).toBeUndefined();
  });
});


describe("round 3 validation and pin ownership", () => {
  it("late validation failure forgets only the generation it authenticated", async () => {
    const { provider } = makeProvider({ proactive: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const alice = await provider.login(ISSUER, { expectedWebId: ALICE });
    const hold = holdOperation();
    const validation = loginProfile(ALICE, ISSUER.href, alice.ownership, provider, async () => {
      await hold.wait();
      throw new Error("offline");
    }).catch((error: unknown) => error);
    await hold.arrived;
    await provider.forgetIssuer(ISSUER);
    asOptions.webIdClaim = BOB;
    await provider.login(ISSUER, { expectedWebId: BOB });
    const credential = store.peek(ISSUER.href);
    hold.release();
    expect(await validation).toBeInstanceOf(WebIdIssuerAuthorityError);
    expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(true);
    expect(store.peek(ISSUER.href)).toEqual(credential);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("an older cross-issuer restore cannot replace an explicit login pin", async () => {
    const { provider: first } = makeProvider();
    await first.login(ISSUER);
    const otherIssuer = new URL("https://other.test");
    const other = await createFakeAuthorizationServer({ issuer: "https://other.test", webIdClaim: BOB });
    const hold = holdOperation();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin === otherIssuer.origin) return other.fetch(request);
      if (new URL(request.url).pathname === "/token") await hold.wait();
      return as.fetch(request);
    });
    const { provider } = makeProvider({ getCode: (url) =>
      url.origin === otherIssuer.origin ? other.authorize(url) : as.authorize(url),
    });
    const restore = provider.restoreIssuer(ISSUER);
    await hold.arrived;
    await provider.login(otherIssuer, { expectedWebId: BOB });
    const before = await provider.upgrade(new Request("https://pod.test/x"));
    hold.release();
    expect((await restore)?.webId).toBe(ALICE);
    const after = await provider.upgrade(new Request("https://pod.test/x"));
    expect(after.headers.get("Authorization")).toBe(before.headers.get("Authorization"));
    expect(provider.canRenewWithoutInteraction(otherIssuer, BOB)).toBe(true);
  });
});


it("issuer-first reauthentication transfers validation ownership before changing accounts", async () => {
  const { provider, getCode } = makeProvider();
  const alice = await provider.login(ISSUER);
  await provider.invalidate(await provider.upgrade(new Request("https://pod.test/x")));
  as.activeRefreshTokens.clear();
  getCode.mockRejectedValueOnce(new Error("cancelled"));
  await expect(provider.upgrade(new Request("https://pod.test/x"))).rejects.toThrow("cancelled");
  asOptions.webIdClaim = BOB;
  const bob = await provider.login(ISSUER);
  expect(bob.webId).toBe(BOB);
  await provider.forgetIssuerIfOwned(ISSUER, alice.ownership);
  expect(provider.canRenewWithoutInteraction(ISSUER, BOB)).toBe(true);
});

it("background reauthentication without a refresh token keeps the established account", async () => {
  as = await createFakeAuthorizationServer({ webIdClaim: ALICE, expiresIn: 120 });
  vi.stubGlobal("fetch", as.fetch);
  const { provider, getCode } = makeProvider();
  await provider.login(ISSUER);
  await provider.invalidate(await provider.upgrade(new Request("https://pod.test/x")));
  // Authorize at the same issuer using a different account on the same server.
  getCode.mockImplementationOnce(async (url) => {
    asOptions = { webIdClaim: BOB, expiresIn: 120 };
    as = await createFakeAuthorizationServer(asOptions);
    vi.stubGlobal("fetch", as.fetch);
    return as.authorize(url);
  });
  await expect(provider.upgrade(new Request("https://pod.test/x"))).rejects.toThrow(SessionIdentityChangedError);
  expect(store.puts).toHaveLength(0);
});

it("a dead proactive grant cannot erase the account bound to later upgrades", async () => {
  const settled = deferred<string>();
  const { provider } = makeProvider({ proactive: true, onProactiveRefreshSettled: (_issuer, outcome) => settled.resolve(outcome) });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await provider.login(ISSUER);
  as.activeRefreshTokens.clear();
  await vi.advanceTimersToNextTimerAsync();
  expect(await settled.promise).toBe("failed");
  expect(vi.getTimerCount()).toBe(0);
  asOptions.webIdClaim = BOB;
  await expect(provider.upgrade(new Request("https://pod.test/x"))).rejects.toThrow(SessionIdentityChangedError);
  expect(store.peek(ISSUER.href)).toBeUndefined();
});

it("issuer-first account change deletes the previous durable credential without a replacement refresh token", async () => {
  const { provider } = makeProvider();
  await provider.login(ISSUER);
  await provider.invalidate(await provider.upgrade(new Request("https://pod.test/x")));
  as = await createFakeAuthorizationServer({ webIdClaim: BOB, expiresIn: 120 });
  vi.stubGlobal("fetch", as.fetch);
  expect((await provider.login(ISSUER)).webId).toBe(BOB);
  expect(store.peek(ISSUER.href)).toBeUndefined();
});
