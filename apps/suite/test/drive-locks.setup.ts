// AUTHORED-BY Codex
import { beforeEach } from "vitest";
import { exclusiveLocks } from "./drive-locks";

beforeEach(() => {
  // UI tests replace navigator with jsdom's instance during module evaluation.
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    value: exclusiveLocks(),
  });
});
