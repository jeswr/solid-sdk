// AUTHORED-BY Claude Opus 5.5

import { afterEach, expect, it, vi } from "vitest";

const ROOT = "https://pod.example/drive/";

async function fresh() {
  vi.resetModules();
  return (await import("../src/apps/drive/state/purge-marker")).claimPurge;
}

afterEach(() => vi.unstubAllGlobals());

it("purges once per session and pod root", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const claim = await fresh();
  expect(claim(ROOT)).toBe(true);
  expect(claim(ROOT)).toBe(false);
  // A reload in the same session finds the stored marker.
  expect((await fresh())(ROOT)).toBe(false);
  expect((await fresh())("https://other.example/drive/")).toBe(true);
});

it("still purges once when session storage refuses the marker", async () => {
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
  });
  const claim = await fresh();
  expect(claim(ROOT)).toBe(true);
  expect(claim(ROOT)).toBe(false);
});
