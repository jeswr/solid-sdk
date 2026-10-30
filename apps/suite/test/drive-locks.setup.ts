// AUTHORED-BY Codex
import { beforeEach } from "vitest";
import { exclusiveLocks } from "./drive-locks";

beforeEach(() => {
  // UI tests replace navigator with jsdom's instance during module evaluation.
  Object.defineProperty(globalThis.navigator, "locks", {
    configurable: true,
    // Bound queued acquisitions below Vitest's 30s budget. Work performed
    // inside an acquired lock keeps its reservation until the callback settles.
    value: exclusiveLocks(20_000),
  });
});
