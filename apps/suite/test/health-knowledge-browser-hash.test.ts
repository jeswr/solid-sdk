// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { exampleHealthKnowledge } from "@jeswr/pkg-health/testing";
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ hashes: 0 }));
// Exercise the exact hash implementation selected by Next's client fallback.
// This runs in Node; the Playwright spec separately compares IDs in Chromium.
vi.mock("node:crypto", async (original) => {
  const native = await original<typeof import("node:crypto")>();
  const { createRequire } = await import("node:module");
  const require = createRequire(new URL("../package.json", import.meta.url));
  const browser = require("next/dist/compiled/crypto-browserify") as Pick<
    typeof native,
    "createHash"
  >;
  return {
    ...native,
    createHash: (...args: Parameters<typeof native.createHash>) => {
      calls.hashes++;
      return browser.createHash(...args);
    },
  };
});
it("reproduces all 77 native sample IDs using Next's browser hash fallback", async () => {
  const expected = JSON.parse(
    await readFile(
      new URL("../e2e/health/fixtures/knowledge-sample-ids.json", import.meta.url),
      "utf8",
    ),
  ) as { ids: string[] };
  const sample = await exampleHealthKnowledge();
  expect(sample.nanopubs.map((np) => np.id).sort()).toEqual(expected.ids);
  expect(sample.nanopubs).toHaveLength(77);
  expect(calls.hashes).toBeGreaterThan(77);
});
