// AUTHORED-BY Codex GPT-6.1-Sol
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstallPromptStore, useInstallPrompt } from "./pwa.js";

let store: ReturnType<typeof createInstallPromptStore>;
let stop: () => void;
let media: EventTarget & { matches: boolean };
const disposers: (() => void)[] = [];

function promptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const prompt = vi.fn(async () => {});
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  window.dispatchEvent(event);
  return { event, prompt };
}

beforeEach(() => {
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store = createInstallPromptStore();
  stop = store.start(window);
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("install prompt store", () => {
  it("starts unavailable with stable server and client snapshots", async () => {
    expect(store.getSnapshot().status).toBe("unavailable");
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.getServerSnapshot().status).toBe("unavailable");
    expect(await store.install()).toBeNull();
  });

  it.each([
    "accepted",
    "dismissed",
  ] as const)("captures one prompt and handles %s", async (outcome) => {
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    const { event, prompt } = promptEvent(outcome);
    expect(event.defaultPrevented).toBe(true);
    expect(store.getSnapshot().status).toBe("available");
    expect(await store.install()).toBe(outcome);
    expect(prompt).toHaveBeenCalledOnce();
    expect(store.getSnapshot().status).toBe(outcome === "accepted" ? "installed" : "unavailable");
    expect(await store.install()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
    promptEvent();
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("consumes a prompt before awaiting it and accepts a later prompt after dismissal", async () => {
    const { prompt } = promptEvent("dismissed");
    const pending = store.install();
    expect(store.getSnapshot().status).toBe("prompting");
    expect(await store.install()).toBeNull();
    expect(await pending).toBe("dismissed");
    expect(prompt).toHaveBeenCalledOnce();
    promptEvent();
    expect(store.getSnapshot().status).toBe("available");
  });

  it("clears rejected prompts and permits a fresh browser event", async () => {
    const { prompt } = promptEvent();
    prompt.mockRejectedValueOnce(new Error("blocked"));
    await expect(store.install()).rejects.toThrow("blocked");
    expect(store.getSnapshot().status).toBe("unavailable");
    promptEvent();
    expect(await store.install()).toBe("accepted");
  });

  it("handles installation through the browser menu", () => {
    promptEvent();
    window.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot().status).toBe("installed");
  });

  it("hides and discards prompts when display mode becomes standalone", async () => {
    promptEvent();
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    expect(store.getSnapshot().status).toBe("installed");
    expect(await store.install()).toBeNull();
    promptEvent();
    expect(store.getSnapshot().status).toBe("installed");
    media.matches = false;
    media.dispatchEvent(new Event("change"));
    expect(store.getSnapshot().status).toBe("unavailable");
  });

  it("does not restore a prompt dismissed after installation", async () => {
    const { prompt } = promptEvent("dismissed");
    prompt.mockImplementationOnce(async () => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    await store.install();
    expect(store.getSnapshot().status).toBe("installed");
  });

  it.each([
    ["iPhone Safari", "iPhone AppleWebKit Safari", "iPhone", 0, "ios"],
    ["iPad Safari desktop mode", "Macintosh AppleWebKit Safari", "MacIntel", 5, "ios"],
    ["Mac Safari", "Macintosh AppleWebKit Safari", "MacIntel", 0, "unavailable"],
    ["iOS Chrome", "iPhone AppleWebKit CriOS Safari", "iPhone", 0, "unavailable"],
    ["iOS Firefox", "iPhone AppleWebKit FxiOS Safari", "iPhone", 0, "unavailable"],
    ["other iOS browser", "iPhone AppleWebKit", "iPhone", 0, "unavailable"],
  ])("detects %s", (_name, userAgent, platform, maxTouchPoints, expected) => {
    stop();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent as string);
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform as string);
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: maxTouchPoints,
    });
    stop = store.start(window);
    expect(store.getSnapshot().status).toBe(expected);
  });

  it("recognizes iOS standalone and initial standalone display mode", () => {
    stop();
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    stop = store.start(window);
    expect(store.getSnapshot().status).toBe("installed");
    stop();
    Reflect.deleteProperty(navigator, "standalone");
    media.matches = true;
    stop = store.start(window);
    expect(store.getSnapshot().status).toBe("installed");
  });

  it("shares listeners across roots and removes them only after the final cleanup", () => {
    const stopSecond = store.start(window);
    stop();
    stop();
    promptEvent();
    expect(store.getSnapshot().status).toBe("available");
    stopSecond();
    window.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot().status).toBe("available");
    stop = store.start(window);
    expect(store.getSnapshot().status).toBe("available");
  });

  it("exposes changes through the React adapter", async () => {
    const element = document.createElement("div");
    const root = createRoot(element);
    function Probe() {
      return createElement("span", null, useInstallPrompt(store).status);
    }
    await act(async () => root.render(createElement(Probe)));
    disposers.push(() => act(() => root.unmount()));
    expect(element.textContent).toBe("unavailable");
    await act(async () => {
      promptEvent();
    });
    expect(element.textContent).toBe("available");
  });
});
