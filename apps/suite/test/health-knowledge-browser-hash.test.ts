// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6.2-Sol
import { readFile } from "node:fs/promises";
import { exampleHealthKnowledge } from "@jeswr/pkg-health/testing";
import { expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ hashes: 0 }));
vi.mock("node:crypto", async (original) => {
  const native = await original<typeof import("node:crypto")>();
  const { createHash } = await import("../src/lib/browser-node-crypto");
  return {
    ...native,
    createHash: (algorithm: string) => {
      calls.hashes++;
      return createHash(algorithm);
    },
  };
});
it("reproduces all 77 native sample IDs using the browser hash shim", async () => {
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
