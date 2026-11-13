// AUTHORED-BY Claude Opus 5.5
import { readFile } from "node:fs/promises";
import { type BenchConfig, isSite } from "./config.js";
import { type BenchTask, SITES, type Site, type TaskType } from "./types.js";

export function substituteUrls(text: string, config: BenchConfig): string {
  let out = text;
  for (const site of SITES)
    out = out.replaceAll(`__${site.toUpperCase()}__`, config.sites[site].baseUrl);
  return out;
}

export function parseTaskIds(text: string): number[] {
  if (!/^\d+(?:,\d+)*$/.test(text))
    throw new Error("--tasks must be comma-separated nonnegative task IDs.");
  const ids = [...new Set(text.split(",").map(Number))];
  if (ids.some((n) => !Number.isSafeInteger(n))) throw new Error("Invalid task ID.");
  return ids;
}

export interface TaskSelection {
  tasks: BenchTask[];
  skipped: { taskId: number; reason: string }[];
}

/** Reads only task type from evaluation metadata; no answer/schema is retained or passed onward. */
export function selectTasks(
  dataset: unknown,
  config: BenchConfig,
  site: Site,
  ids?: number[],
): TaskSelection {
  if (!Array.isArray(dataset)) throw new Error("Dataset must be a JSON array.");
  const tasks: BenchTask[] = [];
  const skipped: TaskSelection["skipped"] = [];
  const seen = new Set<number>();
  for (const row of dataset) {
    if (!Number.isSafeInteger(row.task_id) || row.task_id < 0 || seen.has(row.task_id))
      throw new Error("Invalid or duplicate dataset task ID.");
    seen.add(row.task_id);
    if (ids && !ids.includes(row.task_id)) continue;
    if (!Array.isArray(row.sites)) throw new Error(`Task ${row.task_id}: invalid sites.`);
    if (!row.sites.includes(site)) {
      if (ids) skipped.push({ taskId: row.task_id, reason: `does not use ${site}` });
      continue;
    }
    if (
      !row.sites.every(isSite) ||
      /__(?:WIKIPEDIA|MAP)__/.test(JSON.stringify([row.intent, row.start_urls]))
    ) {
      skipped.push({
        taskId: row.task_id,
        reason: "requires an unavailable site (wikipedia/map or unknown)",
      });
      continue;
    }
    const type = row.eval
      ?.find((e: { evaluator?: string }) => e.evaluator === "AgentResponseEvaluator")
      ?.expected?.task_type?.toUpperCase();
    if (!["RETRIEVE", "MUTATE", "NAVIGATE"].includes(type))
      throw new Error(`Task ${row.task_id}: unknown task type.`);
    if (
      typeof row.intent !== "string" ||
      !Array.isArray(row.start_urls) ||
      !row.start_urls.every((u: unknown) => typeof u === "string")
    )
      throw new Error(`Task ${row.task_id}: invalid intent/start_urls.`);
    const task: BenchTask = {
      task_id: row.task_id,
      sites: row.sites,
      intent: substituteUrls(row.intent, config),
      start_urls: row.start_urls.map((u: string) => substituteUrls(u, config)),
      taskType: type as TaskType,
    };
    if (/__[A-Z_]+__/.test(JSON.stringify(task)))
      throw new Error(`Task ${row.task_id}: unresolved URL placeholder.`);
    tasks.push(task);
  }
  if (ids?.some((id) => !seen.has(id)))
    throw new Error("Requested task ID is absent from the dataset.");
  return { tasks, skipped };
}

export async function loadTasks(
  config: BenchConfig,
  site: Site,
  ids?: number[],
): Promise<TaskSelection> {
  return selectTasks(JSON.parse(await readFile(config.dataset, "utf8")), config, site, ids);
}
