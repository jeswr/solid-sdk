// AUTHORED-BY Codex GPT-6.1-Sol
import { installPrompt } from "@jeswr/suite-sdk/pwa";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InstallApp } from "../src/shell/settings/install-app";
import { act, click, h, mount } from "./drive-ui-dom";

const native = vi.hoisted(() => ({ value: false }));
vi.mock("@jeswr/suite-native", () => ({ isNativeApp: () => native.value }));

let stop: () => void;
beforeEach(() => {
  stop = installPrompt.start(window);
});
afterEach(async () => {
  native.value = false;
  await act(() => window.dispatchEvent(new Event("appinstalled")));
  stop();
  vi.restoreAllMocks();
});

async function capture(outcome: "accepted" | "dismissed") {
  const prompt = vi.fn(async () => {});
  await act(() => {
    window.dispatchEvent(
      Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt,
        userChoice: Promise.resolve({ outcome }),
      }),
    );
  });
  return prompt;
}

it("captures before Settings mounts and installs only after clicking", async () => {
  const prompt = await capture("accepted");
  const view = await mount(h(InstallApp));
  expect(view.host.textContent).toContain("Install app");
  const button = view.host.querySelector("button");
  expect(button?.textContent).toBe("Install");
  expect(prompt).not.toHaveBeenCalled();
  await click(button as HTMLButtonElement);
  expect(prompt).toHaveBeenCalledOnce();
  // The live region stays mounted to announce the outcome.
  expect(view.host.querySelector('[role="status"]')?.textContent).toBe("Solid Suite is installed.");
  expect(view.host.querySelector("button")).toBeNull();
});

it("never offers installation inside the native app", async () => {
  native.value = true;
  await capture("accepted");
  const view = await mount(h(InstallApp));
  expect(view.host.textContent).toBe("");
});

it("consumes dismissed prompts, gives feedback, and allows a fresh prompt", async () => {
  await capture("dismissed");
  const view = await mount(h(InstallApp));
  await click(view.host.querySelector("button") as HTMLButtonElement);
  expect(view.host.querySelector("button")).toBeNull();
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain(
    "Installation dismissed",
  );
  await capture("accepted");
  expect(view.host.querySelector("button")?.disabled).toBe(false);
});

it("reports rejected browser prompts without an unhandled rejection", async () => {
  const prompt = await capture("accepted");
  prompt.mockRejectedValueOnce(new Error("blocked"));
  const view = await mount(h(InstallApp));
  await click(view.host.querySelector("button") as HTMLButtonElement);
  expect(view.host.textContent).toContain("Installation couldn't start");
});

it("hides when unavailable or already standalone", async () => {
  const view = await mount(h(InstallApp));
  expect(view.host.textContent).toBe("");
  await capture("accepted");
  expect(view.host.querySelector("button")).not.toBeNull();
  await act(() => window.dispatchEvent(new Event("appinstalled")));
  expect(view.host.textContent).toBe("");
});

it("offers iOS Safari instructions without an Install button", async () => {
  stop();
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone AppleWebKit Safari");
  stop = installPrompt.start(window);
  const view = await mount(h(InstallApp));
  expect(view.host.textContent).toContain("Use Share, then Add to Home Screen");
  expect(view.host.querySelector("button")).toBeNull();
});
