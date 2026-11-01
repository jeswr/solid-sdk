// AUTHORED-BY Claude Opus 5.5
/**
 * Sign-out and account-switch fencing for `WebIdDPoPTokenProvider`
 * (sst-8xm.6). A login, lazy refresh, proactive refresh or restore that is
 * still in flight when the user signs out must not publish, persist or
 * reschedule its session afterwards, and a same-issuer account switch must
 * never hand back the previous account's tokens.
 *
 * The races are made deterministic by holding the token endpoint open
 * ({@link holdNextTokenRequest}) while the test signs out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FakeAuthorizationServer,
  type FakeAuthorizationServerOptions,
  createFakeAuthorizationServer,
} from "./test-utils/fake-authorization-server";
import { StructuredCloneSessionStore } from "./test-utils/structured-clone-session-store";
import {
  IssuerForgottenError,
  type VisibilityLifecycle,
  WebIdDPoPTokenProvider,
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

function makeProvider(options: { proactive?: boolean; getWebId?: () => Promise<string> } = {}) {
  const getCode = vi.fn((url: URL) => as.authorize(url));
  const provider = new WebIdDPoPTokenProvider(
    CALLBACK,
    getCode,
    options.getWebId ?? (async () => ALICE),
    {
      clientId: CLIENT_ID,
      profileFetch,
      sessionStore: store,
      ...(options.proactive === true
        ? {
            proactiveRefresh: true,
            visibilityLifecycle: visible,
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
    const { provider } = makeProvider({ proactive: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await provider.login(ISSUER);
    expect(store.puts).toHaveLength(1);

    const hold = holdNextTokenRequest();
    await vi.advanceTimersByTimeAsync(120_000); // fire the proactive timer
    await hold.arrived; // the proactive refresh grant is at the token endpoint

    await provider.forgetIssuer(ISSUER);
    vi.useRealTimers();
    hold.release();
    await vi.waitFor(() => expect(refreshGrants()).toHaveLength(1), { timeout: 10_000 });
    // Give the (real-time) response processing a moment to finish; before the
    // fix it re-persisted and re-cached the refreshed session here.
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(store.puts).toHaveLength(1);
    expect(store.peek(ISSUER.href)).toBeUndefined();
    expect(provider.canRenewWithoutInteraction(ISSUER)).toBe(false);
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
