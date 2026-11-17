// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// Vitest global setup: jest-dom matchers + a hard guard that no test performs a
// REAL network fetch. Pod tests inject SDK memory storage; public HTTP tests
// inject stub fetches. An un-stubbed fetch throws rather than hitting the net.
import "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  // jsdom's Blob lacks stream(); the SDK memory backend uses the web Blob API.
  vi.stubGlobal("Blob", NodeBlob);
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
