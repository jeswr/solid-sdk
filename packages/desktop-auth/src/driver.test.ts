// AUTHORED-BY Claude Opus 5.5
import { createPodAuth, type PodAuthOptions } from "@jeswr/pod-auth";
import { createMemoryStore, createMockOp } from "@jeswr/pod-auth/testing";
import { AuthorizationRequestError, BusyError } from "@jeswr/suite-native";
import { afterEach, assert, describe, expect, test, vi } from "vitest";
import { createDesktopCodeDriver } from "./driver.js";
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
    await expect(auth.login({ issuer: op.issuer })).rejects.toThrow();
    expect(op.stats.tokens).toBe(0);
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
    await expect(login).rejects.toThrow();
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
});
