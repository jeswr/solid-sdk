// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import { storageCases } from "./cases.js";
import { runTarget } from "./harness.js";
import { sq8Cases } from "./optional-cases.js";
import { selectTargets } from "./targets/index.js";

// sparq 0.1.6 cannot complete discovery. Explicit TARGET runs still fail closed.
for (const target of selectTargets(process.env.TARGET ?? "memory")) {
  test(
    `storage conformance: ${target.name}`,
    async () => {
      const report = await runTarget(
        target,
        target.name.startsWith("sparq-") ? [...storageCases, ...sq8Cases] : storageCases,
      );
      expect(report.results.filter((row) => row.status === "fail")).toEqual([]);
      expect(
        report.results.filter(
          (row) => row.test.startsWith("SC-") && !row.test.includes(":absence:"),
        ).length,
      ).toBe(storageCases.length);
    },
    target.name === "css" ? 600_000 : 120_000,
  );
}
