// AUTHORED-BY Codex
import { afterEach, beforeEach, vi } from "vitest";
import { exclusiveWebLocks } from "./web-locks";

let navigator: Navigator;
let original: PropertyDescriptor | undefined;
beforeEach(() => {
  if (!globalThis.navigator) vi.stubGlobal("navigator", {});
  navigator = globalThis.navigator;
  original = Object.getOwnPropertyDescriptor(navigator, "locks");
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: exclusiveWebLocks(),
  });
});
afterEach(() => {
  if (original) Object.defineProperty(navigator, "locks", original);
  else Reflect.deleteProperty(navigator, "locks");
});
