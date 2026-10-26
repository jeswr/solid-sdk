import { describe, expect, it } from "vitest";
import { runDemo } from "./demo/run.js";

describe("demo report", () => {
  it("runs every scenario and every check passes", async () => {
    const report = await runDemo();
    const failed = report.scenarios.flatMap((s) =>
      s.checks.filter((c) => !c.pass).map((c) => ({ scenario: s.id, ...c })),
    );
    expect(failed).toEqual([]);
    expect(report.summary.scenarios).toBe(14);
    expect(report.summary.failed).toBe(0);
  }, 60_000);
});
