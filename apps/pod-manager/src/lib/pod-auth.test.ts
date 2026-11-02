// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { AmbiguousIssuerError, type PodAuthOptions } from "@jeswr/pod-auth";
import { fakePodAuth } from "./test-utils-fake-pod-auth";

const create = vi.hoisted(() => vi.fn());
vi.mock("@jeswr/pod-auth", async (original) => ({
  ...(await original<typeof import("@jeswr/pod-auth")>()),
  createPodAuth: create,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  create.mockReset();
});
describe("browser auth singleton", () => {
  it.each([
    ["production", "https://manager.example", false],
    ["development", "http://localhost:3200", true],
    ["development", "http://127.2.3.4:3200", true],
    ["development", "http://[::1]:3200", true],
    ["production", "http://localhost:3200", false],
    ["development", "https://not-localhost.example", false],
  ])("configures %s at %s (loopback %s)", async (mode, origin, loopback) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", new URL(origin));
    const core = fakePodAuth().auth;
    create.mockReturnValue(core);
    const original = globalThis.fetch;
    const runtime = await import("./pod-auth");
    const { CodeRequestCancelledError: CurrentCancellation } = await import(
      "@jeswr/reactive-authentication"
    );
    expect(runtime.getPodAuth()).toBe(core);
    expect(runtime.getPodAuth()).toBe(core);
    expect(create).toHaveBeenCalledOnce();
    const config = create.mock.calls[0][0] as PodAuthOptions;
    expect(config.clientId).toEqual(
      loopback ? { dynamicRegistration: true } : `${origin}/clientid.jsonld`,
    );
    expect(config.redirectUri).toBe(`${origin}/callback.html`);
    expect(config.allowInsecureLoopback).toBe(loopback);
    expect(config.boundary).toBeUndefined();
    expect(globalThis.fetch).toBe(original);
    await expect(config.ui.getWebId()).rejects.toThrow();
    await expect(
      config.ui.chooseIssuer!(["https://a.example/", "https://b.example/"]),
    ).rejects.toBeInstanceOf(AmbiguousIssuerError);
    await expect(
      config.ui.getCode(
        new URL("https://provider.example/authorize"),
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(CurrentCancellation);
    const controller = {
      getCode: vi.fn(
        async () => "https://manager.example/callback.html?code=full&state=full&iss=full",
      ),
    };
    runtime.popupHolder.current = controller as unknown as NonNullable<
      typeof runtime.popupHolder.current
    >;
    await expect(
      config.ui.getCode(
        new URL("https://provider.example/authorize?prompt=none"),
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(CurrentCancellation);
    expect(controller.getCode).not.toHaveBeenCalled();
    expect(
      await config.ui.getCode(
        new URL("https://provider.example/authorize?prompt=consent"),
        new AbortController().signal,
      ),
    ).toContain("state=full&iss=full");
  });
  it("refuses SSR and retries construction after failure", async () => {
    const runtime = await import("./pod-auth");
    expect(() => runtime.getPodAuth()).toThrow("Browser required");
    vi.stubGlobal("window", {});
    vi.stubGlobal("location", new URL("https://manager.example"));
    create
      .mockImplementationOnce(() => {
        throw new Error("initialization failed");
      })
      .mockReturnValue(fakePodAuth().auth);
    expect(() => runtime.getPodAuth()).toThrow("initialization failed");
    expect(runtime.getPodAuth()).toBeDefined();
  });
});
