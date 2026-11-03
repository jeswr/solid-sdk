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
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function browser(blocked = false) {
  const events = new EventTarget();
  const navigate = vi.fn<(href: string) => void>();
  const popup = {
    location: {
      set href(value: string) {
        navigate(value);
      },
    },
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
  return { open, navigate, popup, sourceFetch, callback, events };
}

describe("Connect source login uses package PKCE without persisting tokens", () => {
  it("authorizes through the named popup and exchanges only over the pristine source transport", async () => {
    const { open, navigate, popup, sourceFetch, callback } = browser();
    navigate.mockImplementation((url) => queueMicrotask(() => callback(url)));
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    const result = await login("spotify", config, new AbortController().signal, () => {
      throw new Error("Unexpected blocked popup");
    });
    expect(result.accessToken).toBe("memory-only");
    expect(open).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]?.[0]).toContain("code_challenge_method=S256");
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
    const { navigate, popup, sourceFetch } = browser();
    const controller = new AbortController();
    navigate.mockImplementation(() => queueMicrotask(() => controller.abort()));
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    await expect(login("spotify", config, controller.signal, () => {})).rejects.toThrow();
    expect(popup.closed).toBe(true);
    expect(sourceFetch).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("OAuth cancellation boundaries", () => {
  it("does not create a popup for an already cancelled request", async () => {
    const { open, sourceFetch } = browser();
    const controller = new AbortController();
    controller.abort();
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    await expect(login("spotify", config, controller.signal, () => {})).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(sourceFetch).not.toHaveBeenCalled();
  });
  it("closes a popup when cancellation occurs during its creation", async () => {
    const { open, popup, navigate } = browser();
    const controller = new AbortController();
    open.mockImplementation(() => {
      controller.abort();
      return popup;
    });
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    await expect(login("spotify", config, controller.signal, () => {})).rejects.toThrow();
    expect(popup.closed).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("rejects immediately during PKCE and never reopens or navigates the popup when crypto finishes", async () => {
    const { open, popup, navigate, sourceFetch } = browser();
    const digest = deferred<ArrayBuffer>();
    vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(digest.promise);
    const controller = new AbortController();
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    const pending = login("spotify", config, controller.signal, () => {});
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    await rejected;
    expect(popup.closed).toBe(true);
    digest.resolve(new ArrayBuffer(32));
    await digest.promise;
    await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(sourceFetch).not.toHaveBeenCalled();
  });
  it.each([
    false,
    true,
  ])("cleans callback listeners on cancellation (blocked=%s)", async (blocked) => {
    const { navigate, callback, sourceFetch, events } = browser(blocked);
    const remove = vi.spyOn(window, "removeEventListener");
    const href = deferred<string>();
    navigate.mockImplementation((url) => href.resolve(url));
    const controller = new AbortController();
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    const pending = login("spotify", config, controller.signal, (url) => href.resolve(url));
    const rejected = expect(pending).rejects.toThrow();
    const url = await href.promise;
    controller.abort();
    await rejected;
    callback(url);
    events.dispatchEvent(new MessageEvent("message", { origin, data: {} }));
    expect(remove).toHaveBeenCalledWith("message", expect.any(Function));
    expect(sourceFetch).not.toHaveBeenCalled();
  });
  it("aborts the token exchange transport and cannot return a late token response", async () => {
    const { navigate, callback, sourceFetch, popup } = browser();
    navigate.mockImplementation((url) => queueMicrotask(() => callback(url)));
    const entered = deferred<AbortSignal>();
    const response = deferred<Response>();
    sourceFetch.mockImplementation(async (_input, init) => {
      if (!init?.signal) throw new Error("Exchange must receive an abort signal");
      entered.resolve(init.signal);
      return response.promise;
    });
    const controller = new AbortController();
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    const pending = login("spotify", config, controller.signal, () => {});
    const rejected = expect(pending).rejects.toThrow();
    const receivedSignal = await entered.promise;
    expect(receivedSignal.aborted).toBe(false);
    controller.abort();
    await rejected;
    expect(receivedSignal.aborted).toBe(true);
    expect(popup.closed).toBe(true);
    response.resolve(Response.json({ access_token: "late-token" }));
    await response.promise;
    expect(sourceFetch).toHaveBeenCalledTimes(1);
  });
  it("reports a closed popup but keeps waiting without a timeout until cancelled", async () => {
    const { navigate, popup, sourceFetch } = browser();
    const navigated = deferred<void>();
    navigate.mockImplementation(() => navigated.resolve());
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    vi.useFakeTimers();
    const controller = new AbortController();
    const onClosed = vi.fn();
    let settled = false;
    const pending = login("spotify", config, controller.signal, () => {}, onClosed);
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await navigated.promise;
    popup.close();
    await vi.advanceTimersByTimeAsync(500);
    expect(onClosed).toHaveBeenCalledTimes(1);
    // No fixed sign-in deadline: the user chooses Cancel.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(settled).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(sourceFetch).not.toHaveBeenCalled();
  });
  it("completes through the BroadcastChannel when a COOP provider makes the popup read closed", async () => {
    const { navigate, popup, sourceFetch } = browser();
    const onClosed = deferred<void>();
    navigate.mockImplementation(() => {
      // Cross-Origin-Opener-Policy severs the opener: the still-open popup reads closed.
      popup.closed = true;
    });
    const { login } = await import("../src/apps/home/components/connect/oauth-login");
    const pending = login(
      "spotify",
      config,
      new AbortController().signal,
      () => {},
      () => onClosed.resolve(),
    );
    await onClosed.promise;
    const href = navigate.mock.calls[0]?.[0];
    if (!href) throw new Error("Missing authorization request");
    const channel = new BroadcastChannel("suite-connector-oauth");
    channel.postMessage({
      type: "pod-manager-oauth",
      url: `${origin}/oauth-callback.html?code=good&state=${new URL(href).searchParams.get("state")}`,
    });
    channel.close();
    expect((await pending).accessToken).toBe("memory-only");
    expect(sourceFetch).toHaveBeenCalledTimes(1);
  });
});

// AUTHORED-BY Claude Opus 5.5
describe("OAuth callback page", () => {
  async function callbackScript() {
    const { readFile } = await import("node:fs/promises");
    const html = await readFile(new URL("../public/oauth-callback.html", import.meta.url), "utf8");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!script) throw new Error("Missing callback script");
    return script;
  }
  function page(opener: { postMessage: (...args: unknown[]) => void } | null, close: () => void) {
    const steps: string[] = [];
    const location = new URL(`${origin}/oauth-callback.html?code=c&state=s`);
    class Channel {
      constructor(readonly name: string) {}
      postMessage(message: { url: string }) {
        steps.push(`channel ${this.name} ${message.url}`);
      }
      close() {}
    }
    const window = {
      opener: opener && {
        postMessage: (...args: unknown[]) => {
          steps.push("opener");
          opener.postMessage(...args);
        },
      },
      close: () => {
        steps.push("close");
        close();
      },
    };
    const history = { replaceState: () => steps.push("replace") };
    return { steps, window, location, history, Channel };
  }
  it("posts the callback to the opener and the channel, then tries to close itself", async () => {
    const script = await callbackScript();
    const opener = { postMessage: vi.fn() };
    const { steps, window, location, history, Channel } = page(opener, () => {});
    new Function("window", "location", "history", "BroadcastChannel", script)(
      window,
      location,
      history,
      Channel,
    );
    expect(opener.postMessage).toHaveBeenCalledWith(
      { type: "pod-manager-oauth", url: location.href },
      origin,
    );
    expect(steps).toEqual([
      "opener",
      `channel suite-connector-oauth ${location.href}`,
      "replace",
      "close",
    ]);
  });
  it("still posts through the channel and survives a refused close when COOP severed the opener", async () => {
    const script = await callbackScript();
    const { steps, window, location, history, Channel } = page(null, () => {
      throw new Error("Scripts may not close windows they did not open.");
    });
    expect(() =>
      new Function("window", "location", "history", "BroadcastChannel", script)(
        window,
        location,
        history,
        Channel,
      ),
    ).not.toThrow();
    expect(steps).toEqual([`channel suite-connector-oauth ${location.href}`, "replace", "close"]);
  });
});
