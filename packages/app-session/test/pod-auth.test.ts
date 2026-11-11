// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Codex GPT-6.1-Sol
import type { PodAuthOptions } from "@jeswr/pod-auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const factory = vi.hoisted(() => ({ create: vi.fn(), register: vi.fn() }));
vi.mock("@jeswr/pod-auth", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-auth")>()),
  createPodAuth: factory.create,
}));
vi.mock("@jeswr/reactive-authentication/registerElements", () => {
  factory.register();
  return {};
});
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function coreAt(origin: string, dev = true) {
  const location = new URL(origin);
  vi.stubGlobal("location", location);

  const module = await import("../src/pod-auth");
  expect(factory.create).not.toHaveBeenCalled();
  const getPodAuth = module.createAppPodAuth({
    clientId: "https://app.example/clientid.jsonld",
    redirectUri: "https://app.example/callback.html",
    dev,
  });
  await getPodAuth();
  return { options: factory.create.mock.calls[0]?.[0] as PodAuthOptions, getPodAuth };
}

describe("page-lifetime pod-auth core", () => {
  it("creates lazily once, uses the app base and automatic boundary, and preserves global fetch", async () => {
    const fetch = globalThis.fetch;
    const core = {};
    factory.create.mockReturnValue(core);
    const { options, getPodAuth } = await coreAt("https://docs.example");
    const first = getPodAuth();
    expect(getPodAuth()).toBe(first);
    expect(await first).toBe(core);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(factory.register).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({
      clientId: "https://app.example/clientid.jsonld",
      redirectUri: "https://app.example/callback.html",
      allowInsecureLoopback: false,
    });
    expect(options).not.toHaveProperty("boundary");
    expect(globalThis.fetch).toBe(fetch);
    await expect(options.ui.getWebId()).rejects.toThrow();
  });

  it("rejects multiple issuers with the shared typed error, without choosing silently", async () => {
    const { options } = await coreAt("https://docs.example");
    const { AmbiguousIssuerError } = await import("@jeswr/pod-auth");
    await expect(
      options.ui.chooseIssuer?.(["https://one.example/", "https://two.example/"]),
    ).rejects.toBeInstanceOf(AmbiguousIssuerError);
    // The listed issuers travel with the error so the card can offer them.
    await expect(
      options.ui.chooseIssuer?.(["https://one.example/", "https://two.example/"]),
    ).rejects.toMatchObject({ issuers: ["https://one.example/", "https://two.example/"] });
  });

  it("delegates the complete callback URL and abort signal to the current holder", async () => {
    const { options } = await coreAt("https://docs.example");
    const { authFlowHolder } = await import("../src/auth-flow-holder");
    const callback =
      "https://docs.example/callback.html?code=code&state=state&iss=https%3A%2F%2Fprovider.example%2F";
    const current = vi.fn(async () => callback);
    authFlowHolder.current = current;
    const url = new URL("https://provider.example/authorize");
    const signal = new AbortController().signal;
    expect(await options.ui.getCode(url, signal)).toBe(callback);
    expect(current).toHaveBeenCalledWith(url, signal);
    authFlowHolder.current = null;
  });

  it.each([
    ["http://localhost:5173", true],
    ["http://127.0.0.1:5173", true],
    ["http://127.25.0.4:5173", true],
    ["http://[::1]:5173", true],
    ["https://docs.example", false],
    ["https://localhost.attacker.example", false],
    ["http://192.168.1.5", false],
    ["http://128.0.0.1", false],
  ])("permits insecure loopback for %s: %s", async (origin, expected) => {
    const { options } = await coreAt(origin);
    expect(options.allowInsecureLoopback).toBe(expected);
    // HTTP loopback cannot use a Client Identifier Document; it registers dynamically.
    if (expected) expect(options.clientId).toEqual({ dynamicRegistration: true });
    else expect(typeof options.clientId).toBe("string");
  });

  it("keeps a production build HTTPS-only even on a loopback host", async () => {
    const { options } = await coreAt("http://localhost:5173", false);
    expect(options.allowInsecureLoopback).toBe(false);
    expect(typeof options.clientId).toBe("string");
  });

  it("captures the pristine public fetch at module load and omits cookies", async () => {
    const pristine = vi.fn<typeof fetch>(async () => new Response("public"));
    vi.stubGlobal("fetch", pristine);
    const { publicFetch } = await import("../src/pod-auth");
    const replacement = vi.fn();
    vi.stubGlobal("fetch", replacement);
    await publicFetch("https://profile.example/#me", { credentials: "include" });
    expect(pristine).toHaveBeenCalledWith("https://profile.example/#me", { credentials: "omit" });
    expect(replacement).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(replacement);
  });

  it("does not create a core outside the browser", async () => {
    vi.stubGlobal("window", undefined);
    const { createAppPodAuth, allowInsecureLoopback } = await import("../src/pod-auth");
    const getPodAuth = createAppPodAuth({
      redirectUri: "https://app.example/callback.html",
      dev: true,
    });
    vi.stubGlobal("location", undefined);
    expect(allowInsecureLoopback(true)).toBe(false);
    await expect(getPodAuth()).rejects.toThrow("Browser required");
    expect(factory.create).not.toHaveBeenCalled();
  });
  it("retries a failed initialization and forwards explicit application options", async () => {
    vi.stubGlobal("location", new URL("https://app.example/"));
    const { createAppPodAuth } = await import("../src/pod-auth");
    const chooseIssuer = vi.fn(async () => "https://chosen.example/");
    const boundary = { roots: ["https://storage.example/"] };
    factory.create.mockImplementationOnce(() => {
      throw new Error("initialization failed");
    });
    const core = {};
    factory.create.mockReturnValue(core);
    const get = createAppPodAuth({
      clientId: "https://app.example/clientid.jsonld",
      redirectUri: "https://app.example/callback.html",
      dev: false,
      chooseIssuer,
      boundary,
      maxReplayBodyBytes: 1024,
    });
    await expect(get()).rejects.toThrow("initialization failed");
    await expect(get()).resolves.toBe(core);
    expect(factory.create).toHaveBeenCalledTimes(2);
    expect(factory.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        boundary,
        maxReplayBodyBytes: 1024,
        ui: expect.objectContaining({ chooseIssuer }),
      }),
    );
  });

  it("rejects a missing client identifier outside development loopback", async () => {
    vi.stubGlobal("location", new URL("https://app.example/"));
    const { createAppPodAuth } = await import("../src/pod-auth");
    const get = createAppPodAuth({
      redirectUri: "https://app.example/callback.html",
      dev: true,
    });
    await expect(get()).rejects.toThrow("HTTPS Client Identifier Document");
    await expect(get()).rejects.toThrow("HTTPS Client Identifier Document");
    expect(factory.create).not.toHaveBeenCalled();
  });

  it("accepts an undefined client identifier only for development loopback", async () => {
    vi.stubGlobal("location", new URL("http://localhost:5173"));
    const { createAppPodAuth, isLoopbackHost } = await import("../src/pod-auth");
    await createAppPodAuth({
      redirectUri: "http://localhost:5173/callback.html",
      dev: true,
    })();
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: { dynamicRegistration: true } }),
    );
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("127.256.0.1")).toBe(false);
  });

  it("derives the client identifier and callback from the app base, lazily", async () => {
    vi.stubGlobal("location", new URL("https://jeswr.github.io/solid-sdk/pod-docs/"));
    const { createAppPodAuth } = await import("../src/pod-auth");
    const get = createAppPodAuth({ base: "/solid-sdk/pod-docs/", dev: false });
    expect(factory.create).not.toHaveBeenCalled();
    await get();
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "https://jeswr.github.io/solid-sdk/pod-docs/clientid.jsonld",
        redirectUri: "https://jeswr.github.io/solid-sdk/pod-docs/callback.html",
        allowInsecureLoopback: false,
      }),
    );
  });

  it("uses dynamic registration instead of the derived identifier on development loopback", async () => {
    vi.stubGlobal("location", new URL("http://localhost:5173/"));
    const { createAppPodAuth } = await import("../src/pod-auth");
    await createAppPodAuth({ base: "/", dev: true })();
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: { dynamicRegistration: true },
        redirectUri: "http://localhost:5173/callback.html",
        allowInsecureLoopback: true,
      }),
    );
  });

  it("keeps the derived identifier for a production build served on localhost", async () => {
    vi.stubGlobal("location", new URL("http://localhost:4173/"));
    const { createAppPodAuth } = await import("../src/pod-auth");
    await createAppPodAuth({ base: "/", dev: false })();
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "http://localhost:4173/clientid.jsonld",
        allowInsecureLoopback: false,
      }),
    );
  });

  it("requires a redirect URI or an app base", async () => {
    vi.stubGlobal("location", new URL("https://app.example/"));
    const { createAppPodAuth } = await import("../src/pod-auth");
    await expect(createAppPodAuth({ dev: false })()).rejects.toThrow(
      "A redirect URI or app base is required",
    );
    expect(factory.create).not.toHaveBeenCalled();
  });
});
