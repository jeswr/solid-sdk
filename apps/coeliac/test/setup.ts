// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// Vitest global setup: jest-dom matchers + a hard guard that no test performs a
// REAL network fetch. Every test must stub `fetch` (the injectable-fetch seam) —
// a suite invariant (health data never leaves a test box; no server in unit
// tests). An un-stubbed fetch throws loudly rather than silently hitting the net.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(
        `Un-stubbed fetch in a test: ${String(
          input,
        )} — pass a stub fetch through the injectable seam.`,
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
