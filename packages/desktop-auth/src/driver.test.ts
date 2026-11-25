// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Claude Sonnet 5.5
import { createPodAuth, type PodAuthOptions } from "@jeswr/pod-auth";
import { createMemoryStore, createMockOp } from "@jeswr/pod-auth/testing";
import {
  AuthorizationRequestError,
  type AuthSessionPlugin,
  BusyError,
  NativeAuthError,
  SuiteNativeError,
  USER_CANCELLED,
  UserCancelledError,
} from "@jeswr/suite-native";
import { afterEach, assert, describe, expect, test, vi } from "vitest";
import { createDesktopCodeDriver, withDesktopAuthErrors } from "./driver.js";
import { DesktopAuthError } from "./errors.js";
import type { DesktopHost } from "./session.js";

const redirectUri = "ai.artcraft.app:/oauth/callback";
const clientId = "https://artcraft.example/solid-client-id.jsonld";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function required<T>(value: T | null | undefined): T {
  assert(value !== undefined && value !== null);
  return value;
}

/**
 * A desktop host backed by the mock identity provider: "opening the browser" follows the
 * authorization URL to the provider's redirect, and the operating system then routes that
 * callback (after any noise the test injects) to the app's deep-link listener.
 */
function providerHost(op: ReturnType<typeof createMockOp>, noise: string[] = []) {
  let listener: ((urls: string[]) => void) | null = null;
  const opened: string[] = [];
  const host: DesktopHost = {
    async onOpenUrl(handler) {
      listener = handler;
      return () => {
        listener = null;
      };
    },
    async openUrl(url) {
      opened.push(url);
      const callback = await op.getCode(new URL(url), new AbortController().signal);
      queueMicrotask(() => {
        listener?.(noise);
        listener?.([callback]);
      });
    },
  };
  return { host, opened };
}

function fixture(host: (op: ReturnType<typeof createMockOp>) => DesktopHost) {
  const op = createMockOp({ requireInteraction: true, refreshTokens: true });
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    if (request.url === clientId) {
      const document = await (await op.fetch(op.clientId)).json();
      return Response.json({
        ...document,
        client_id: clientId,
        application_type: "native",
        redirect_uris: [redirectUri],
      });
    }
    return op.fetch(request);
  });
  const getCode = createDesktopCodeDriver({ host: host(op), redirectUri });
  const options: PodAuthOptions = {
    clientId,
    redirectUri,
    nativeRedirect: true,
    storage: { sessions: createMemoryStore(), caches: createMemoryStore() },
    ui: { getWebId: async () => required(op.webId), getCode },
  };
  return { op, options, requests };
}

describe("createDesktopCodeDriver with pod-auth", () => {
  test("signs in through the system browser and a deep link, and restores after restart", async () => {
    let opened: string[] = [];
    const { op, options } = fixture((op) => {
      const made = providerHost(op);
      opened = made.opened;
      return made.host;
    });
    const auth = createPodAuth(options);
    // Not vacuous: the private resource refuses an anonymous read.
    expect((await auth.fetch(`${op.root}private`)).status).toBe(401);
    const identity = await auth.login({ issuer: op.issuer });
    expect(identity).toMatchObject({ webId: op.webId, storages: [op.root] });
    expect(await (await auth.fetch(`${op.root}private`)).text()).toBe("protected Solid");
    // The host only ever saw the authorization URL, never a code verifier or token.
    expect(opened).toHaveLength(1);
    const authorization = new URL(required(opened[0]));
    expect(authorization.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.has("code_verifier")).toBe(false);

    const restarted = createPodAuth(options);
    expect(await restarted.restore()).toMatchObject({ webId: op.webId });
    expect((await restarted.fetch(`${op.root}private`)).status).toBe(200);
    expect(opened).toHaveLength(1);
    await restarted.logout();
    expect(await restarted.remembered()).toEqual([]);
  });

  test("ignores stray deep links that arrive before the real callback", async () => {
    const { op, options } = fixture(
      (op) =>
        providerHost(op, [
          `${redirectUri}?code=forged&state=wrong&iss=${encodeURIComponent(op.issuer)}`,
          "ai.artcraft.app://evil.example/oauth/callback?state=x",
          "https://evil.example/",
        ]).host,
    );
    const auth = createPodAuth(options);
    expect(await auth.login({ issuer: op.issuer })).toMatchObject({ webId: op.webId });
    expect(op.stats.tokens).toBe(1);
  });

  test("a callback from the wrong issuer is refused", async () => {
    const { op, options } = fixture((op) => {
      let listener: ((urls: string[]) => void) | null = null;
      return {
        async onOpenUrl(handler) {
          listener = handler;
          return () => undefined;
        },
        async openUrl(url) {
          const callback = new URL(await op.getCode(new URL(url), new AbortController().signal));
          callback.searchParams.set("iss", "https://attacker.example/");
          queueMicrotask(() => listener?.([callback.href]));
        },
      };
    });
    const auth = createPodAuth(options);
    await expect(auth.login({ issuer: op.issuer })).rejects.toMatchObject({
      name: "OperationProcessingError",
      message: expect.stringContaining("iss"),
    });
    expect(op.stats.tokens).toBe(0);
    expect((await auth.fetch(`${op.root}private`)).status).toBe(401);
  });

  test("an error callback is refused end to end and no token request happens", async () => {
    const { op, options, requests } = fixture((op) => {
      let listener: ((urls: string[]) => void) | null = null;
      return {
        async onOpenUrl(handler) {
          listener = handler;
          return () => undefined;
        },
        async openUrl(url) {
          const callback = new URL(await op.getCode(new URL(url), new AbortController().signal));
          callback.searchParams.delete("code");
          callback.searchParams.set("error", "access_denied");
          queueMicrotask(() => listener?.([callback.href]));
        },
      };
    });
    const auth = createPodAuth(options);
    const failure = await auth.login({ issuer: op.issuer }).then(
      () => undefined,
      (error: unknown) => error,
    );
    // pod-auth rejects the error response, after its own issuer check.
    expect(failure).toMatchObject({ name: "AuthorizationResponseError" });
    expect(op.stats.tokens).toBe(0);
    expect(requests.some((request) => new URL(request.url).pathname === "/token")).toBe(false);
    expect((await auth.fetch(`${op.root}private`)).status).toBe(401);
  });

  test("aborting the sign-in stops waiting and keeps nothing", async () => {
    const opened: string[] = [];
    const { op, options } = fixture(() => ({
      async onOpenUrl() {
        return () => undefined;
      },
      async openUrl(url) {
        opened.push(url);
      },
    }));
    const auth = createPodAuth(options);
    const controller = new AbortController();
    const login = auth.login({ issuer: op.issuer }, { signal: controller.signal });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    controller.abort();
    await expect(login).rejects.toMatchObject({ name: "AbortError" });
    expect(op.stats.tokens).toBe(0);
    expect(await auth.remembered()).toEqual([]);
  });
});

describe("createDesktopCodeDriver on its own", () => {
  const host: DesktopHost = {
    async onOpenUrl() {
      return () => undefined;
    },
    async openUrl() {},
  };

  test("refuses a redirect that is not a private-use scheme", () => {
    expect(() =>
      createDesktopCodeDriver({ host, redirectUri: "https://artcraft.example/callback" }),
    ).toThrow(TypeError);
  });

  test("refuses an authorization URL for another redirect before opening anything", async () => {
    const openUrl = vi.fn(async () => undefined);
    const getCode = createDesktopCodeDriver({ host: { ...host, openUrl }, redirectUri });
    const url = new URL("https://idp.example/authorize");
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "com.other.app:/oauth/callback",
      code_challenge: "abc",
      code_challenge_method: "S256",
      state: "s",
    }))
      url.searchParams.set(key, value);
    await expect(getCode(url, new AbortController().signal)).rejects.toBeInstanceOf(
      AuthorizationRequestError,
    );
    expect(openUrl).not.toHaveBeenCalled();
  });

  test("after an abort, a new sign-in starts instead of being refused as busy", async () => {
    const opened: string[] = [];
    const getCode = createDesktopCodeDriver({
      host: { ...host, openUrl: async (url) => void opened.push(url) },
      redirectUri,
    });
    const url = new URL("https://idp.example/authorize");
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: "abc",
      code_challenge_method: "S256",
      state: "s",
    }))
      url.searchParams.set(key, value);
    const controller = new AbortController();
    const pending = getCode(url, controller.signal);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const second = new AbortController();
    const again = getCode(url, second.signal);
    await vi.waitFor(() => expect(opened).toHaveLength(2));
    second.abort();
    await expect(again).rejects.not.toBeInstanceOf(BusyError);
  });

  const request = (overrides: Record<string, string> = {}) => {
    const url = new URL("https://idp.example/authorize");
    for (const [key, value] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: "abc",
      code_challenge_method: "S256",
      state: "s",
      ...overrides,
    }))
      url.searchParams.set(key, value);
    return url;
  };

  test("refuses an http://localhost authorization URL before opening anything", async () => {
    const openUrl = vi.fn(async () => undefined);
    const getCode = createDesktopCodeDriver({ host: { ...host, openUrl }, redirectUri });
    const url = request();
    const local = new URL(`http://localhost:3000/authorize${url.search}`);
    await expect(getCode(local, new AbortController().signal)).rejects.toBeInstanceOf(
      AuthorizationRequestError,
    );
    expect(openUrl).not.toHaveBeenCalled();
  });

  test("a timeout rejects with DesktopAuthError timed-out and nothing from the host", async () => {
    let fire: () => void = () => undefined;
    const getCode = createDesktopCodeDriver({
      host,
      redirectUri,
      setTimeout: (callback) => {
        fire = callback;
        return 1;
      },
      clearTimeout: () => undefined,
    });
    const pending = getCode(request(), new AbortController().signal);
    await vi.waitFor(() => expect(fire).not.toBe(undefined));
    await Promise.resolve();
    fire();
    const error = await pending.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DesktopAuthError);
    expect(error).toBeInstanceOf(SuiteNativeError);
    expect(error).toMatchObject({
      name: "DesktopAuthError",
      code: "timed-out",
      message: "timed-out",
    });
  });

  test("a host failure rejects with DesktopAuthError host-failed and never carries the host's error", async () => {
    const failure = new Error("secret path /home/me/.config");
    const getCode = createDesktopCodeDriver({
      host: {
        ...host,
        openUrl: async () => {
          throw failure;
        },
      },
      redirectUri,
    });
    const error = (await getCode(request(), new AbortController().signal).then(
      () => undefined,
      (caught: unknown) => caught,
    )) as DesktopAuthError;
    expect(error).toBeInstanceOf(DesktopAuthError);
    expect(error).toMatchObject({ code: "host-failed", message: "host-failed" });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(String(error.stack)).not.toContain("secret");
  });

  test("a host that cannot listen is also host-failed, and the next call starts afresh", async () => {
    const listen = vi.fn<DesktopHost["onOpenUrl"]>();
    listen.mockRejectedValueOnce(new Error("no deep links"));
    listen.mockImplementation(async () => () => undefined);
    const opened: string[] = [];
    const getCode = createDesktopCodeDriver({
      host: { onOpenUrl: listen, openUrl: async (url) => void opened.push(url) },
      redirectUri,
    });
    await expect(getCode(request(), new AbortController().signal)).rejects.toMatchObject({
      name: "DesktopAuthError",
      code: "host-failed",
    });
    const controller = new AbortController();
    const again = getCode(request(), controller.signal);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    controller.abort();
    await expect(again).rejects.toMatchObject({ name: "AbortError" });
  });

  test("an abort still rejects with the AbortError, not a DesktopAuthError", async () => {
    const getCode = createDesktopCodeDriver({ host, redirectUri });
    const controller = new AbortController();
    const pending = getCode(request(), controller.signal);
    await Promise.resolve();
    controller.abort();
    const error = await pending.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeInstanceOf(DesktopAuthError);
    expect(error).toMatchObject({ name: "AbortError" });
  });

  test("a second call while one is pending is refused as busy and does not disturb the first", async () => {
    let fire: () => void = () => undefined;
    const getCode = createDesktopCodeDriver({
      host,
      redirectUri,
      setTimeout: (callback) => {
        fire = callback;
        return 1;
      },
      clearTimeout: () => undefined,
    });
    const first = getCode(request(), new AbortController().signal);
    await vi.waitFor(() => expect(fire).not.toBe(undefined));
    await expect(getCode(request(), new AbortController().signal)).rejects.toBeInstanceOf(
      BusyError,
    );
    fire();
    await expect(first).rejects.toMatchObject({ name: "DesktopAuthError", code: "timed-out" });
  });
});

describe("withDesktopAuthErrors", () => {
  const url = new URL(
    `https://idp.example/authorize?response_type=code&client_id=c&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=abc&code_challenge_method=S256&state=s`,
  );
  const plugin = (reject: () => unknown): AuthSessionPlugin => ({
    authenticate: async () => {
      throw reject();
    },
    cancel: async () => undefined,
  });
  const signal = () => new AbortController().signal;

  test("a cancelled session is still a UserCancelledError", async () => {
    const getCode = withDesktopAuthErrors(
      plugin(() => Object.assign(new Error("x"), { code: USER_CANCELLED })),
      redirectUri,
    );
    await expect(getCode(url, signal())).rejects.toBeInstanceOf(UserCancelledError);
  });

  test.each([
    ["an error with another code", () => Object.assign(new Error("x"), { code: "OTHER" })],
    ["an error with no code", () => new Error("x")],
    ["a thrown null", () => null],
  ])("%s stays the driver's NativeAuthError", async (_name, reject) => {
    const getCode = withDesktopAuthErrors(plugin(reject), redirectUri);
    const error = await getCode(url, signal()).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(NativeAuthError);
    expect(error).not.toBeInstanceOf(DesktopAuthError);
  });

  test("the record of an earlier failure never leaks into a later call", async () => {
    let next: () => unknown = () => Object.assign(new Error("x"), { code: "TIMED_OUT" });
    const getCode = withDesktopAuthErrors(
      { authenticate: async () => Promise.reject(next()), cancel: async () => undefined },
      redirectUri,
    );
    await expect(getCode(url, signal())).rejects.toMatchObject({ code: "timed-out" });
    next = () => new Error("x");
    const error = await getCode(url, signal()).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(NativeAuthError);
    expect(error).not.toBeInstanceOf(DesktopAuthError);
  });
});
