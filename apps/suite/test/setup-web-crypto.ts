// AUTHORED-BY Codex
import { webcrypto } from "node:crypto";
import { beforeEach } from "vitest";

beforeEach(() => {
  // jsdom supplies getRandomValues but omits the browser's SubtleCrypto implementation.
  Object.defineProperty(globalThis.crypto, "subtle", {
    configurable: true,
    value: webcrypto.subtle,
  });
});
