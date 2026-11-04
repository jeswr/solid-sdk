// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, it, vi } from "vitest";
import { missingPlatformFeatures } from "../src/lib/native/startup-check";
import { h, mount } from "./drive-ui-dom";

const complete = () => ({
  isSecureContext: true,
  crypto: { subtle: {} },
  navigator: { locks: { request: () => undefined } },
  indexedDB: { open: () => undefined },
});

it("passes a WebView with all four features", () => {
  expect(missingPlatformFeatures(complete())).toEqual([]);
});

it.each([
  ["secure-context", { isSecureContext: false }],
  ["secure-context", { isSecureContext: undefined }],
  ["web-crypto", { crypto: {} }],
  ["web-crypto", { crypto: { subtle: null } }],
  ["web-crypto", { crypto: undefined }],
  ["web-locks", { navigator: {} }],
  ["web-locks", { navigator: { locks: {} } }],
  ["indexeddb", { indexedDB: undefined }],
  ["indexeddb", { indexedDB: {} }],
] as const)("reports a missing %s", (feature, change) => {
  expect(missingPlatformFeatures({ ...complete(), ...change })).toEqual([feature]);
});

it("reports every missing feature in a fixed order", () => {
  expect(missingPlatformFeatures({})).toEqual([
    "secure-context",
    "web-crypto",
    "web-locks",
    "indexeddb",
  ]);
});

// The DOM harness installs its globals with vi.stubGlobal, so restore only what these tests set.
const restore: (() => void)[] = [];
function setGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  restore.push(() =>
    previous
      ? Object.defineProperty(globalThis, name, previous)
      : Reflect.deleteProperty(globalThis, name),
  );
}
afterEach(() => {
  while (restore.length) restore.pop()?.();
  vi.resetModules();
});

async function gate() {
  vi.resetModules();
  return (await import("../src/components/native-startup-gate")).NativeStartupGate;
}

it("renders the app once the check passes", async () => {
  setGlobal("isSecureContext", true);
  setGlobal("navigator", { ...navigator, locks: { request: () => undefined } });
  setGlobal("indexedDB", { open: () => undefined });
  const Gate = await gate();
  const view = await mount(h(Gate, null, h("span", null, "Pod content")));
  expect(view.host.textContent).toBe("Pod content");
});

it("shows the update screen instead of the app when a feature is missing", async () => {
  setGlobal("isSecureContext", true);
  setGlobal("navigator", { ...navigator, locks: undefined });
  setGlobal("indexedDB", { open: () => undefined });
  const Gate = await gate();
  const view = await mount(h(Gate, null, h("span", null, "Pod content")));
  expect(view.host.textContent).toContain("Update needed");
  expect(view.host.textContent).not.toContain("Pod content");
  expect(view.host.querySelector("main")?.dataset.missing).toBe("web-locks");
});

it("renders nothing below the gate in the exported HTML", async () => {
  const { renderToString } = await import("react-dom/server");
  const Gate = await gate();
  expect(renderToString(h(Gate, null, h("span", null, "Pod content")))).toBe("");
});
