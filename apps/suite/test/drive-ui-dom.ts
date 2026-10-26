// AUTHORED-BY Codex
// Reuse suite-ui's installed DOM harness without adding application dependencies.
import { createRequire } from "node:module";
import { act, createElement, type ReactNode } from "react";
import { afterEach, vi } from "vitest";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { JSDOM } = requireUi("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis };
};
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://suite.example/drive/my",
});
vi.stubGlobal("self", dom.window);
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "NodeFilter",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FocusEvent",
  "DOMRect",
  "getComputedStyle",
  "localStorage",
  "sessionStorage",
] as const) {
  vi.stubGlobal(key, key === "window" ? dom.window : dom.window[key]);
}
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(callback, 0));
vi.stubGlobal("cancelAnimationFrame", clearTimeout);
vi.stubGlobal("addEventListener", dom.window.addEventListener.bind(dom.window));
vi.stubGlobal("removeEventListener", dom.window.removeEventListener.bind(dom.window));
vi.stubGlobal("CSS", { escape: (value: string) => value.replace(/["\\]/g, "\\$&") });
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Object.defineProperty(dom.window, "matchMedia", {
  configurable: true,
  value: (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
  }),
});
const { createRoot } = await import("react-dom/client");
const mounted = new Set<() => Promise<void>>();
afterEach(async () => {
  for (const unmount of mounted) await unmount();
});

export const h = createElement;
export { act };
export async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
    mounted.delete(unmount);
  };
  mounted.add(unmount);
  try {
    await act(async () => root.render(node));
  } catch (error) {
    await unmount();
    throw error;
  }
  return {
    host,
    async render(next: ReactNode) {
      await act(async () => root.render(next));
    },
    unmount,
  };
}
export async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
export async function key(element: Element, value: string, shiftKey = false) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
