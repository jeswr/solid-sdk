#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { isSite, loadConfig, positiveInteger } from "./config.js";
import { loadTasks, parseTaskIds } from "./dataset.js";
import { evaluateBenchmark } from "./evaluate.js";
import { profileBenchmark } from "./profile.js";
import { runBenchmark, writeJson } from "./run.js";

const defaultConfig = fileURLToPath(new URL("../bench.config.json", import.meta.url));
export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    allowPositionals: true,
    options: {
      config: { type: "string", default: defaultConfig },
      site: { type: "string" },
      tasks: { type: "string" },
      planner: { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      "max-steps": { type: "string" },
      "timeout-ms": { type: "string" },
      python: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !positionals.length) {
    console.log(
      "webarena-bench profile --site <site> [--config path]\nwebarena-bench run --site <site> [--tasks 1,2] --planner claude|codex --model <model> --out <dir> [--max-steps n] [--timeout-ms n]\nwebarena-bench evaluate --out <dir> [--python python3]",
    );
    return;
  }
  const [command] = positionals;
  if (positionals.length !== 1 || !["profile", "run", "evaluate"].includes(command ?? ""))
    throw new Error("Expected profile, run or evaluate. Use --help.");
  if (command === "evaluate") {
    if (!values.out) throw new Error("--out is required.");
    await evaluateBenchmark(values.out, values.python);
    console.log(`Wrote ${resolve(values.out, "summary.json")} and summary.md`);
    return;
  }
  if (!isSite(values.site))
    throw new Error("--site must be shopping, shopping_admin, reddit or gitlab.");
  if (
    command === "run" &&
    (!values.out || !values.model || !["claude", "codex"].includes(values.planner ?? ""))
  )
    throw new Error("run requires --out, --model and --planner claude|codex.");
  const config = await loadConfig(values.config);
  if (values["max-steps"] !== undefined)
    config.maxSteps = positiveInteger(Number(values["max-steps"]), "--max-steps");
  if (values["timeout-ms"] !== undefined)
    config.taskTimeoutMs = positiveInteger(Number(values["timeout-ms"]), "--timeout-ms");
  if (command === "profile") {
    console.log(await profileBenchmark(config, values.site));
    return;
  }
  if (!values.out || !values.model) throw new Error("Missing run options.");
  const selection = await loadTasks(
    config,
    values.site,
    values.tasks !== undefined ? parseTaskIds(values.tasks) : undefined,
  );
  for (const skipped of selection.skipped) console.log(`Skip ${skipped.taskId}: ${skipped.reason}`);
  if (!selection.tasks.length) throw new Error("No runnable tasks selected.");
  const out = resolve(values.out);
  await runBenchmark({
    config,
    tasks: selection.tasks,
    out,
    planner: values.planner as "claude" | "codex",
    model: values.model,
  });
  await writeJson(resolve(out, "selection.json"), {
    site: values.site,
    selected: selection.tasks.map((t) => t.task_id),
    skipped: selection.skipped,
  });
  console.log(`Wrote ${selection.tasks.length} task submissions under ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Benchmark failed.");
    process.exitCode = 1;
  });
}
