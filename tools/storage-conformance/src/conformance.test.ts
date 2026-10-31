// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import { storageCases } from "./cases.js";
import { runTarget } from "./harness.js";
import { selectTargets } from "./targets/index.js";

// The same scenarios run in the package gate and the CLI; TARGET narrows local iterations.
for (const target of selectTargets(process.env.TARGET)) {
  test(`storage conformance: ${target.name}`, async () => {
    const report = await runTarget(target, storageCases);
    expect(report.results.filter((row) => row.status === "fail")).toEqual([]);
    expect(
      report.results.filter((row) => row.test.startsWith("SC-") && !row.test.includes(":absence:"))
        .length,
    ).toBe(storageCases.length);
  }, 120_000);
}
