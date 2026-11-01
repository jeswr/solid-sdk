// AUTHORED-BY Codex GPT-6
import type { OAuthAppConfig } from "@jeswr/pod-connectors";
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://suite.example";
const config: OAuthAppConfig = {
  clientId: "public-client",
  authorizationEndpoint: "https://source.example/authorize",
  tokenEndpoint: "https://source.example/token",
  scopes: ["read"],
  tokenExchange: "public",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browser(blocked = false) {
  const events = new EventTarget();
  const popup = {
    closed: false,
    close() {
      this.closed = true;
    },
  };
  const sourceFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ access_token: "memory-only", token_type: "Bearer" }),
  );
  const open = vi.fn((_url: string) => (blocked ? null : popup));
  vi.stubGlobal("fetch", sourceFetch);
  vi.stubGlobal("window", {
    location: new URL(`${origin}/connect/spotify`),
    open,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    setInterval,
    clearInterval,
  });
  const callback = (href: string, answerOrigin = origin) => {
    const auth = new URL(href);
    const url = `${origin}/oauth-callback.html?code=example-code&state=${auth.searchParams.get("state")}`;
    events.dispatchEvent(
      new MessageEvent("message", {
        origin: answerOrigin,
        data: { type: "pod-manager-oauth", url },
      }),
    );
  };
  return { open, popup, sourceFetch, callback, events };
}

describe("Connect source login uses package PKCE without persisting tokens", () => {
  it("authorizes through the named popup and exchanges only over the pristine source transport", async () => {
    const { open, popup, sourceFetch, callback } = browser();
    open.mockImplementation((url) => {
      if (url) queueMicrotask(() => callback(url));
      return popup;
    });
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    const result = await login("spotify", config, new AbortController().signal, () => {
      throw new Error("Unexpected blocked popup");
    });
    expect(result.accessToken).toBe("memory-only");
    expect(open.mock.calls[1]?.[0]).toContain("code_challenge_method=S256");
    expect(sourceFetch).toHaveBeenCalledTimes(1);
    expect(sourceFetch.mock.calls[0]?.[0]).toBe("https://source.example/token");
    expect(popup.closed).toBe(true);
  });
  it("offers a fresh PKCE fallback link, rejects unrelated callbacks and receives an opener-free callback", async () => {
    const { sourceFetch, events } = browser(true);
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    let href = "";
    const result = await login("spotify", config, new AbortController().signal, (value) => {
      href = value;
      events.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://other.example",
          data: { type: "pod-manager-oauth", url: value },
        }),
      );
      events.dispatchEvent(
        new MessageEvent("message", {
          origin,
          data: { type: "pod-manager-oauth", url: "not a URL" },
        }),
      );
      events.dispatchEvent(
        new MessageEvent("message", {
          origin,
          data: {
            type: "pod-manager-oauth",
            url: `${origin}/oauth-callback.html?code=bad&state=wrong`,
          },
        }),
      );
      const channel = new BroadcastChannel("suite-connector-oauth");
      channel.postMessage({
        type: "pod-manager-oauth",
        url: `${origin}/oauth-callback.html?code=good&state=${new URL(value).searchParams.get("state")}`,
      });
      channel.close();
    });
    expect(href).toContain("code_challenge_method=S256");
    expect(result.accessToken).toBe("memory-only");
    expect(sourceFetch).toHaveBeenCalledTimes(1);
  });
  it("cancels waiting login and closes the named popup", async () => {
    const { open, popup, sourceFetch } = browser();
    const controller = new AbortController();
    open.mockImplementation((url) => {
      if (url) queueMicrotask(() => controller.abort());
      return popup;
    });
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    await expect(login("spotify", config, controller.signal, () => {})).rejects.toThrow();
    expect(popup.closed).toBe(true);
    expect(sourceFetch).not.toHaveBeenCalled();
  });
});
