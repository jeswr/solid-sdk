// AUTHORED-BY Claude Opus 5.5
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateBenchmark, summarize } from "../src/evaluate.js";
import type { TaskMetrics } from "../src/types.js";

const metrics = (taskId: number): TaskMetrics => ({
  taskId,
  sites: ["gitlab", "reddit"],
  taskType: "MUTATE",
  steps: 3,
  promptTokensEstimate: 120,
  wallTimeMs: 1000,
  outcome: "answer",
});
describe("evaluation reports", () => {
  it("groups by site and type, counts multi-site tasks only once in ALL", () => {
    const rows = summarize([
      { metrics: metrics(1), status: "SUCCESS", score: 1 },
      { metrics: metrics(2), status: "FAILURE", score: 0 },
    ]);
    expect(rows.find((r) => r.site === "ALL" && r.taskType === "ALL")).toMatchObject({
      tasks: 2,
      successRate: 0.5,
      meanSteps: 3,
      meanPromptTokensEstimate: 120,
      wallTimeMs: 2000,
    });
    expect(rows.find((r) => r.site === "gitlab" && r.taskType === "MUTATE")?.tasks).toBe(2);
  });
  it("never counts stale/missing results as successes, and writes a report if Python fails", async () => {
    const out = await mkdtemp(join(tmpdir(), "webarena-eval-"));
    try {
      await mkdir(join(out, "1"));
      await writeFile(join(out, "1/metrics.json"), JSON.stringify(metrics(1)));
      await writeFile(
        join(out, "1/eval_result.json"),
        JSON.stringify({ task_id: 1, status: "SUCCESS", score: 1 }),
      );
      await expect(
        evaluateBenchmark(out, "fixture-python", async () => {
          throw new Error("missing dependency");
        }),
      ).rejects.toThrow("missing dependency");
      const summary = JSON.parse(await readFile(join(out, "summary.json"), "utf8"));
      expect(
        summary.rows.find(
          (r: { site: string; taskType: string }) => r.site === "ALL" && r.taskType === "ALL",
        ),
      ).toMatchObject({ tasks: 1, successes: 0, evaluationErrors: 1 });
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
