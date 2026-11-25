// AUTHORED-BY Claude Opus 5.5
import { spawn } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeJson } from "./run.js";
import type { TaskMetrics } from "./types.js";

export interface SummaryRow {
  site: string;
  taskType: string;
  tasks: number;
  successes: number;
  evaluationErrors: number;
  successRate: number;
  meanSteps: number;
  meanPromptTokensEstimate: number;
  meanWallTimeMs: number;
  wallTimeMs: number;
}
export interface ScoredTask {
  metrics: TaskMetrics;
  status: string;
  score: number;
}

export function summarize(tasks: ScoredTask[]): SummaryRow[] {
  const groups = new Map<string, ScoredTask[]>();
  for (const task of tasks) {
    for (const site of [...task.metrics.sites, "ALL"]) {
      for (const type of [task.metrics.taskType, "ALL"]) {
        const key = `${site}/${type}`;
        const entries = groups.get(key) ?? [];
        entries.push(task);
        groups.set(key, entries);
      }
    }
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const [site = "", taskType = ""] = key.split("/");
      const sum = (field: "steps" | "promptTokensEstimate" | "wallTimeMs") =>
        group.reduce((total, t) => total + t.metrics[field], 0);
      const successes = group.filter((t) => t.status === "SUCCESS" && t.score === 1).length;
      return {
        site,
        taskType,
        tasks: group.length,
        successes,
        evaluationErrors: group.filter((t) => t.status === "ERROR").length,
        successRate: successes / group.length,
        meanSteps: sum("steps") / group.length,
        meanPromptTokensEstimate: sum("promptTokensEstimate") / group.length,
        meanWallTimeMs: sum("wallTimeMs") / group.length,
        wallTimeMs: sum("wallTimeMs"),
      };
    });
}

export function summaryMarkdown(rows: SummaryRow[]): string {
  return (
    "<!-- AUTHORED-BY Claude Opus 5.5 -->\n# WebArena-Verified benchmark\n\n" +
    "Prompt tokens are character-based estimates, not provider billing counts. Multi-site tasks count in each participating site; ALL counts each task once.\n\n" +
    "| Site | Type | Tasks | Success rate | Eval errors | Mean steps | Mean prompt tokens (est.) | Mean wall s | Total wall s |\n" +
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n" +
    rows
      .map(
        (r) =>
          `| ${r.site} | ${r.taskType} | ${r.tasks} | ${(r.successRate * 100).toFixed(1)}% | ${r.evaluationErrors} | ${r.meanSteps.toFixed(1)} | ${r.meanPromptTokensEstimate.toFixed(1)} | ${(r.meanWallTimeMs / 1000).toFixed(2)} | ${(r.wallTimeMs / 1000).toFixed(2)} |`,
      )
      .join("\n") +
    "\n"
  );
}

export async function invokeEvaluator(python: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(python, args, { stdio: "inherit" });
    child.on("error", () =>
      reject(
        new Error("Could not start Python; install webarena-verified==1.2.3 in that interpreter."),
      ),
    );
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`WebArena evaluator exited with ${code}.`)),
    );
  });
}

export async function evaluateBenchmark(
  out: string,
  python = "python3",
  invoke = invokeEvaluator,
): Promise<SummaryRow[]> {
  const directory = resolve(out);
  const ids = (await readdir(directory, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a) - Number(b));
  if (!ids.length) throw new Error("No task submission directories found.");
  const metrics: TaskMetrics[] = [];
  for (const id of ids) {
    const record: TaskMetrics = JSON.parse(
      await readFile(join(directory, id, "metrics.json"), "utf8"),
    );
    if (record.taskId !== Number(id))
      throw new Error("Metrics task ID differs from submission directory.");
    metrics.push(record);
    await rm(join(directory, id, "eval_result.json"), { force: true });
  }
  let cliError: unknown;
  try {
    await invoke(python, ["-m", "webarena_verified", "eval-tasks", "--output-dir", directory]);
  } catch (error) {
    cliError = error;
  }
  const scored: ScoredTask[] = [];
  for (const record of metrics) {
    let status = "ERROR";
    let score = 0;
    try {
      const result = JSON.parse(
        await readFile(join(directory, String(record.taskId), "eval_result.json"), "utf8"),
      );
      if (
        result.task_id !== record.taskId ||
        !["SUCCESS", "FAILURE", "ERROR"].includes(result.status) ||
        typeof result.score !== "number"
      )
        throw new Error("Invalid evaluator result.");
      status = result.status;
      score = result.score;
    } catch {
      /* Missing/invalid evaluator outputs remain visible failures in the denominator. */
    }
    scored.push({ metrics: record, status, score });
  }
  const rows = summarize(scored);
  await writeJson(join(directory, "summary.json"), {
    evaluator: "webarena-verified/1.2.3",
    promptTokens: "estimate: ceil(prompt characters / 4)",
    tasks: scored,
    rows,
    ...(cliError
      ? { error: "Python evaluator failed; missing results counted as evaluation errors." }
      : {}),
  });
  await writeFile(join(directory, "summary.md"), summaryMarkdown(rows), { mode: 0o600 });
  if (cliError) throw cliError;
  return rows;
}
