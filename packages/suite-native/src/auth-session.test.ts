// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test, vi } from "vitest";
import {
  type AuthSessionPlugin,
  createNativeCodeDriver,
  type NativeCodeDriverOptions,
  USER_CANCELLED,
} from "./auth-session.js";
import {
  AuthorizationError,
  AuthorizationRequestError,
  BusyError,
  NativeAuthError,
  StateMismatchError,
  UserCancelledError,
} from "./errors.js";

const REDIRECT = "org.jeswr.suite:/oauth/callback";
const ISSUER = "https://idp.example/";
const resolveIssuer = () => ISSUER;
const ISS = `iss=${encodeURIComponent(ISSUER)}`;

function authUrl(overrides: Record<string, string | string[] | null> = {}, base?: string): URL {
  const url = new URL(base ?? "https://idp.example/authorize");
  const params: Record<string, string | string[] | null> = {
    response_type: "code",
    client_id: "https://suite.example/.well-known/solid-client-id-mobile.jsonld",
    redirect_uri: REDIRECT,
    code_challenge: "abc",
    code_challenge_method: "S256",
    state: "s1",
    scope: "openid webid offline_access",
    ...overrides,
  };
  for (const [key, value] of Object.entries(params)) {
    if (value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
  }
  return url;
}

function plugin(callback: string | (() => Promise<{ url: string }>)) {
  const fake = {
    authenticate: vi.fn(
      typeof callback === "string" ? async () => ({ url: callback }) : callback,
    ) as AuthSessionPlugin["authenticate"] & ReturnType<typeof vi.fn>,
    cancel: vi.fn(async () => undefined),
  };
  return fake;
}

const signal = () => new AbortController().signal;

describe("createNativeCodeDriver configuration", () => {
  test.each([
    ["not a URI", "callback"],
    ["https scheme", "https://suite.example/callback"],
    ["http scheme", "http://localhost/callback"],
    ["scheme without a dot", "suite:/oauth/callback"],
    ["scheme ending in a dot", "org.jeswr.:/cb"],
    ["javascript scheme", "javascript:/alert(1)"],
    ["authority", "org.jeswr.suite://host/oauth/callback"],
    ["query", "org.jeswr.suite:/oauth/callback?x=1"],
    ["fragment", "org.jeswr.suite:/oauth/callback#x"],
    ["opaque path", "org.jeswr.suite:oauth"],
  ])("rejects a redirect URI with %s", (_, redirectUri) => {
    expect(() =>
      createNativeCodeDriver({ plugin: plugin(""), redirectUri, resolveIssuer }),
    ).toThrow(TypeError);
  });
});

describe("authorization request checks", () => {
  const driver = (allowInsecureLoopback?: boolean) =>
    createNativeCodeDriver({
      plugin: plugin(`${REDIRECT}?code=c&state=s1&${ISS}`),
      redirectUri: REDIRECT,
      resolveIssuer,
      allowInsecureLoopback,
    });

  test.each([
    ["http authorization endpoint", authUrl({}, "http://idp.example/authorize")],
    ["credentials in the URL", authUrl({}, "https://user:pw@idp.example/authorize")],
    ["missing response_type", authUrl({ response_type: null })],
    ["implicit response_type", authUrl({ response_type: "token" })],
    ["missing client_id", authUrl({ client_id: null })],
    ["two client_ids", authUrl({ client_id: ["a", "b"] })],
    ["another redirect_uri", authUrl({ redirect_uri: "org.jeswr.evil:/oauth/callback" })],
    ["two redirect_uris", authUrl({ redirect_uri: [REDIRECT, REDIRECT] })],
    ["missing code_challenge", authUrl({ code_challenge: null })],
    ["empty code_challenge", authUrl({ code_challenge: "" })],
    ["plain PKCE", authUrl({ code_challenge_method: "plain" })],
    ["missing code_challenge_method", authUrl({ code_challenge_method: null })],
    ["fragment response mode", authUrl({ response_mode: "fragment" })],
    ["conflicting response modes", authUrl({ response_mode: ["query", "form_post"] })],
    ["repeated query response mode", authUrl({ response_mode: ["query", "query"] })],
    ["missing state", authUrl({ state: null })],
    ["two states", authUrl({ state: ["s1", "s2"] })],
  ])("rejects %s", async (_, url) => {
    await expect(driver()(url, signal())).rejects.toBeInstanceOf(AuthorizationRequestError);
  });

  test("rejects http loopback unless allowed", async () => {
    const url = authUrl({}, "http://localhost:3000/.oidc/auth");
    await expect(driver()(url, signal())).rejects.toBeInstanceOf(AuthorizationRequestError);
    await expect(driver(true)(url, signal())).resolves.toBe("c");
  });

  test("allowing loopback does not allow other http hosts", async () => {
    const url = authUrl({}, "http://idp.example/authorize");
    await expect(driver(true)(url, signal())).rejects.toBeInstanceOf(AuthorizationRequestError);
  });

  test("accepts an explicit query response mode", async () => {
    await expect(driver()(authUrl({ response_mode: "query" }), signal())).resolves.toBe("c");
  });

  test("opens the URL it validated even if the caller mutates it meanwhile", async () => {
    const fake = plugin(`${REDIRECT}?code=c&state=s1&${ISS}`);
    const url = authUrl();
    const validated = url.href;
    const getCode = createNativeCodeDriver({
      plugin: fake,
      redirectUri: REDIRECT,
      resolveIssuer: async (requested) => {
        url.href = "https://evil.example/auth?response_type=token";
        requested.href = "https://evil.example/other";
        return ISSUER;
      },
    });
    await expect(getCode(url, signal())).resolves.toBe("c");
    expect(fake.authenticate).toHaveBeenCalledExactlyOnceWith({
      url: validated,
      callbackScheme: "org.jeswr.suite",
    });
  });

  test("never opens the browser for a rejected request", async () => {
    const fake = plugin(`${REDIRECT}?code=c&state=s1&${ISS}`);
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    await expect(getCode(authUrl({ state: null }), signal())).rejects.toThrow();
    expect(fake.authenticate).not.toHaveBeenCalled();
  });
});

describe("callback checks", () => {
  const run = (callback: string, url = authUrl()) =>
    createNativeCodeDriver({ plugin: plugin(callback), redirectUri: REDIRECT, resolveIssuer })(
      url,
      signal(),
    );

  test("returns the code and passes the URL and scheme to the plugin", async () => {
    const fake = plugin(`${REDIRECT}?code=the-code&state=s1&iss=https%3A%2F%2Fidp.example%2F`);
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    const url = authUrl();
    await expect(getCode(url, signal())).resolves.toBe("the-code");
    expect(fake.authenticate).toHaveBeenCalledWith({
      url: url.href,
      callbackScheme: "org.jeswr.suite",
    });
  });

  test.each([
    ["a non-URL", "::::"],
    ["another scheme", "org.jeswr.evil:/oauth/callback?code=c&state=s1"],
    ["an authority", "org.jeswr.suite://evil/oauth/callback?code=c&state=s1"],
    ["another path", "org.jeswr.suite:/other?code=c&state=s1"],
    ["a fragment", `${REDIRECT}?code=c&state=s1&${ISS}#code=x`],
    ["no code", `${REDIRECT}?state=s1&${ISS}`],
    ["an empty code", `${REDIRECT}?code=&state=s1&${ISS}`],
    ["two codes", `${REDIRECT}?code=a&code=b&state=s1&${ISS}`],
    ["no issuer", `${REDIRECT}?code=c&state=s1`],
    ["an empty issuer", `${REDIRECT}?code=c&state=s1&iss=`],
    ["two issuers", `${REDIRECT}?code=c&state=s1&${ISS}&${ISS}`],
    ["an issuer that is not exact", `${REDIRECT}?code=c&state=s1&iss=https://idp.example`],
    ["a foreign issuer", `${REDIRECT}?code=c&state=s1&iss=https://evil.example/`],
    ["an issuer with another path", `${REDIRECT}?code=c&state=s1&iss=https://idp.example/x`],
    ["an empty error", `${REDIRECT}?error=&state=s1&${ISS}`],
    [
      "an error from another issuer",
      `${REDIRECT}?error=access_denied&state=s1&iss=https://evil.example/`,
    ],
  ])("rejects a callback with %s", async (_, callback) => {
    await expect(run(callback)).rejects.toBeInstanceOf(AuthorizationRequestError);
  });

  test.each([
    ["a different state", `${REDIRECT}?code=c&state=s2`],
    ["no state", `${REDIRECT}?code=c`],
    ["two states", `${REDIRECT}?code=c&state=s1&state=s1`],
    ["an error and the wrong state", `${REDIRECT}?error=access_denied&state=evil`],
  ])("reports a state mismatch for %s", async (_, callback) => {
    await expect(run(callback)).rejects.toBeInstanceOf(StateMismatchError);
  });

  test("surfaces an error response as AuthorizationError, never as a code", async () => {
    const error = await run(
      `${REDIRECT}?error=access_denied&error_description=Nope&state=s1&code=c&${ISS}`,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error).toMatchObject({ code: "access_denied", description: "Nope" });
    expect((error as Error).message).toBe("Authorization failed (access_denied): Nope");
  });

  test("describes an error response without a description", async () => {
    const error = await run(`${REDIRECT}?error=server_error&state=s1&${ISS}`).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "server_error", description: undefined });
    expect((error as Error).message).toBe("Authorization failed (server_error)");
  });

  test("rejects a plugin result without a URL", async () => {
    const fake = plugin(async () => undefined as unknown as { url: string });
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    await expect(getCode(authUrl(), signal())).rejects.toBeInstanceOf(AuthorizationRequestError);
  });
});

describe("issuer resolution (RFC 9207)", () => {
  const driver = (resolve: NativeCodeDriverOptions["resolveIssuer"], callback: string) =>
    createNativeCodeDriver({
      plugin: plugin(callback),
      redirectUri: REDIRECT,
      resolveIssuer: resolve,
    });

  test("passes the authorization URL to the resolver", async () => {
    const resolve = vi.fn(async () => ISSUER);
    const url = authUrl();
    await expect(
      driver(resolve, `${REDIRECT}?code=c&state=s1&${ISS}`)(url, signal()),
    ).resolves.toBe("c");
    expect(resolve).toHaveBeenCalledWith(url);
  });

  test("compares the issuer identifier exactly, including its path", async () => {
    const issuer = "https://idp.example/realms/solid";
    const callback = `${REDIRECT}?code=c&state=s1&iss=${encodeURIComponent(issuer)}`;
    await expect(driver(() => issuer, callback)(authUrl(), signal())).resolves.toBe("c");
    await expect(driver(() => `${issuer}/`, callback)(authUrl(), signal())).rejects.toBeInstanceOf(
      AuthorizationRequestError,
    );
  });

  test.each([
    ["throws", () => Promise.reject(new Error("no metadata"))],
    ["returns nothing", () => undefined as unknown as string],
    ["returns an empty issuer", () => ""],
  ])("fails closed when the resolver %s", async (_, resolve) => {
    const fake = plugin(`${REDIRECT}?code=c&state=s1&${ISS}`);
    const getCode = createNativeCodeDriver({
      plugin: fake,
      redirectUri: REDIRECT,
      resolveIssuer: resolve,
    });
    await expect(getCode(authUrl(), signal())).rejects.toBeInstanceOf(AuthorizationRequestError);
    expect(fake.authenticate).not.toHaveBeenCalled();
  });

  test("aborting while the issuer resolves never opens the browser", async () => {
    const controller = new AbortController();
    const fake = plugin(`${REDIRECT}?code=c&state=s1&${ISS}`);
    const getCode = createNativeCodeDriver({
      plugin: fake,
      redirectUri: REDIRECT,
      resolveIssuer: async () => {
        controller.abort();
        return ISSUER;
      },
    });
    await expect(getCode(authUrl(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fake.authenticate).not.toHaveBeenCalled();
  });
});

describe("session lifecycle", () => {
  test("rejects immediately when already aborted", async () => {
    const fake = plugin(`${REDIRECT}?code=c&state=s1&${ISS}`);
    const controller = new AbortController();
    controller.abort();
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    await expect(getCode(authUrl(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fake.authenticate).not.toHaveBeenCalled();
  });

  test("abort cancels the native session and rejects with AbortError", async () => {
    let fail: (e: unknown) => void = () => undefined;
    const fake = plugin(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    fake.cancel.mockImplementation(async () => fail({ code: USER_CANCELLED }));
    const controller = new AbortController();
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    const pending = getCode(authUrl(), controller.signal);
    await vi.waitFor(() => expect(fake.authenticate).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.cancel).toHaveBeenCalledOnce();
  });

  test("abort wins even if the browser returns a callback afterwards", async () => {
    let finish: (v: { url: string }) => void = () => undefined;
    const fake = plugin(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fake.cancel.mockRejectedValue(new Error("nothing to cancel"));
    const controller = new AbortController();
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    const pending = getCode(authUrl(), controller.signal);
    await vi.waitFor(() => expect(fake.authenticate).toHaveBeenCalled());
    controller.abort();
    finish({ url: `${REDIRECT}?code=c&state=s1&${ISS}` });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  test("abort settles a native session that never settles and frees the slot", async () => {
    const fake = plugin(() => new Promise(() => undefined));
    const controller = new AbortController();
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    const pending = getCode(authUrl(), controller.signal);
    await vi.waitFor(() => expect(fake.authenticate).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.cancel).toHaveBeenCalledOnce();
    fake.authenticate.mockImplementation(async () => ({
      url: `${REDIRECT}?code=d&state=s1&${ISS}`,
    }));
    await expect(getCode(authUrl(), signal())).resolves.toBe("d");
  });

  test("abort settles an issuer lookup that never settles and skips the browser", async () => {
    let lookups = 0;
    let finishLookup: (issuer: string) => void = () => undefined;
    const fake = plugin(`${REDIRECT}?code=c&state=s1&${ISS}`);
    const controller = new AbortController();
    const getCode = createNativeCodeDriver({
      plugin: fake,
      redirectUri: REDIRECT,
      resolveIssuer: () => {
        lookups++;
        return lookups === 1
          ? new Promise<string>((resolve) => {
              finishLookup = resolve;
            })
          : ISSUER;
      },
    });
    const pending = getCode(authUrl(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(getCode(authUrl(), signal())).resolves.toBe("c");
    finishLookup(ISSUER);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.authenticate).toHaveBeenCalledOnce();
  });

  test("maps a dismissed sheet to UserCancelledError", async () => {
    const fake = plugin(async () => Promise.reject({ code: USER_CANCELLED }));
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    await expect(getCode(authUrl(), signal())).rejects.toBeInstanceOf(UserCancelledError);
  });

  test.each([
    ["an Error", new Error("boom")],
    ["null", null],
  ])("maps a native failure (%s) to NativeAuthError", async (_, failure) => {
    const fake = plugin(async () => Promise.reject(failure));
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    await expect(getCode(authUrl(), signal())).rejects.toBeInstanceOf(NativeAuthError);
  });

  test("allows one session at a time and frees the slot afterwards", async () => {
    let finish: (v: { url: string }) => void = () => undefined;
    const fake = plugin(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const getCode = createNativeCodeDriver({ plugin: fake, redirectUri: REDIRECT, resolveIssuer });
    const first = getCode(authUrl(), signal());
    await expect(getCode(authUrl(), signal())).rejects.toBeInstanceOf(BusyError);
    finish({ url: `${REDIRECT}?code=c&state=s1&${ISS}` });
    await expect(first).resolves.toBe("c");
    fake.authenticate.mockImplementation(async () => ({
      url: `${REDIRECT}?code=d&state=s1&${ISS}`,
    }));
    await expect(getCode(authUrl(), signal())).resolves.toBe("d");
  });

  test("a rejected request does not hold the session slot", async () => {
    const getCode = createNativeCodeDriver({
      plugin: plugin(`${REDIRECT}?code=c&state=s1&${ISS}`),
      redirectUri: REDIRECT,
      resolveIssuer,
    });
    await expect(getCode(authUrl({ state: null }), signal())).rejects.toThrow();
    await expect(getCode(authUrl(), signal())).resolves.toBe("c");
  });
});
