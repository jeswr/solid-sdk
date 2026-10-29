// AUTHORED-BY Codex
import { beforeEach } from "vitest";
import { exclusiveLocks } from "./drive-locks";

beforeEach(() => {
  // UI tests replace navigator with jsdom's instance during module evaluation.
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    // Recursive access discovery runs inside the lock, including under v8 coverage.
    // Keep a deadlock deadline below Vitest's 30s budget without timing out valid IO.
    value: exclusiveLocks(20_000),
  });
});
