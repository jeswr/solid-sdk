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

async function coreAt(origin: string) {
  const location = new URL(origin);
  vi.stubGlobal("location", location);
  vi.stubEnv("BASE_URL", "/solid-sdk/pod-docs/");
  const module = await import("./pod-auth");
  expect(factory.create).not.toHaveBeenCalled();
  await module.getPodAuth();
  return factory.create.mock.calls[0][0] as PodAuthOptions;
}

describe("page-lifetime pod-auth core", () => {
  it("creates lazily once, uses the app base and automatic boundary, and preserves global fetch", async () => {
    const fetch = globalThis.fetch;
    const core = {};
    factory.create.mockReturnValue(core);
    const options = await coreAt("https://docs.example");
    const module = await import("./pod-auth");
    const first = module.getPodAuth();
    expect(module.getPodAuth()).toBe(first);
    expect(await first).toBe(core);
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(factory.register).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({
      clientId: "https://docs.example/solid-sdk/pod-docs/clientid.jsonld",
      redirectUri: "https://docs.example/solid-sdk/pod-docs/callback.html",
      allowInsecureLoopback: false,
    });
    expect(options).not.toHaveProperty("boundary");
    expect(globalThis.fetch).toBe(fetch);
    await expect(options.ui.getWebId()).rejects.toThrow();
  });

  it("rejects multiple issuers with the shared typed error, without choosing silently", async () => {
    const options = await coreAt("https://docs.example");
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
    const options = await coreAt("https://docs.example");
    const { authFlowHolder } = await import("./auth-flow-holder");
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
    const options = await coreAt(origin);
    expect(options.allowInsecureLoopback).toBe(expected);
    // HTTP loopback cannot use a Client Identifier Document; it registers dynamically.
    if (expected) expect(options.clientId).toEqual({ dynamicRegistration: true });
    else expect(typeof options.clientId).toBe("string");
  });

  it("keeps a production build HTTPS-only even on a loopback host", async () => {
    vi.stubEnv("DEV", false);
    const options = await coreAt("http://localhost:5173");
    expect(options.allowInsecureLoopback).toBe(false);
    expect(typeof options.clientId).toBe("string");
  });

  it("captures the pristine public fetch at module load and omits cookies", async () => {
    const pristine = vi.fn<typeof fetch>(async () => new Response("public"));
    vi.stubGlobal("fetch", pristine);
    const { publicFetch } = await import("./pod-auth");
    const replacement = vi.fn();
    vi.stubGlobal("fetch", replacement);
    await publicFetch("https://profile.example/#me", { credentials: "include" });
    expect(pristine).toHaveBeenCalledWith("https://profile.example/#me", { credentials: "omit" });
    expect(replacement).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(replacement);
  });

  it("does not create a core outside the browser", async () => {
    vi.stubGlobal("window", undefined);
    const { getPodAuth, allowInsecureLoopback } = await import("./pod-auth");
    vi.stubGlobal("location", undefined);
    expect(allowInsecureLoopback()).toBe(false);
    await expect(getPodAuth()).rejects.toThrow("Browser required");
    expect(factory.create).not.toHaveBeenCalled();
  });
});
