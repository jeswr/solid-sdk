// AUTHORED-BY Claude Opus 5.5
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  claudeCliPlanner,
  codexCliPlanner,
  createExecutorFetch,
  createTaskExecutor,
  loginWithPassword,
  type Planner,
  type PlannerHistory,
  promptFor,
  runTask,
  type TaskTrace,
} from "@jeswr/agent-browser";
import { InMemorySessions, siteOrigin } from "@jeswr/site-executor";
import { readSiteModel, type SiteModel } from "@jeswr/site-model";
import { DataFactory, Writer } from "n3";
import { type BenchConfig, evaluatorConfig } from "./config.js";
import { Deadline } from "./deadline.js";
import { combineExecutors, getPage } from "./execution.js";
import { captureHar } from "./har.js";
import { errorResponse, finalPage, mapResponse, responseInstructions } from "./response.js";
import type { BenchTask, Site, TaskMetrics, Transport } from "./types.js";

export const writeJson = (path: string, value: unknown) =>
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

async function pageFact(url: string): Promise<string> {
  const { namedNode } = DataFactory;
  const writer = new Writer();
  writer.addQuad(
    namedNode(url),
    namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
    namedNode("https://schema.org/WebPage"),
  );
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}

export interface RunOptions {
  config: BenchConfig;
  tasks: BenchTask[];
  out: string;
  planner: "claude" | "codex";
  model: string;
  /** Tests inject a scripted planner and optionally an in-process transport/models. */
  plannerFactory?: (task: BenchTask) => Planner;
  transport?: Transport;
  models?: Partial<Record<Site, SiteModel>>;
}

export async function runBenchmark(options: RunOptions): Promise<TaskMetrics[]> {
  const { config } = options;
  const models: Partial<Record<Site, SiteModel>> = { ...options.models };
  for (const site of new Set(options.tasks.flatMap((t) => t.sites))) {
    models[site] ??= await readSiteModel(
      await readFile(join(config.modelsDir, `${site}.ttl`), "utf8"),
    );
    if (siteOrigin(models[site].site) !== siteOrigin(config.sites[site].baseUrl))
      throw new Error(`Model origin for ${site} differs from config; profile again.`);
  }
  await mkdir(options.out, { recursive: true, mode: 0o700 });
  const metrics: TaskMetrics[] = [];
  for (const task of options.tasks) {
    const directory = join(options.out, String(task.task_id));
    // Never silently overwrite a prior attempt (nor mix old eval_result.json with a new run).
    await mkdir(directory, { mode: 0o700 });
    const deadline = new Deadline(config.taskTimeoutMs);
    const began = performance.now();
    const har = captureHar(
      options.transport ?? fetch,
      deadline.controller.signal,
      task.sites.flatMap((site) => config.sites[site].login?.password ?? []),
    );
    let trace: TaskTrace | undefined;
    let error: string | undefined;
    let promptTokens = 0;
    const tokenEstimates: number[] = [];
    const approvals: { id: string; summary: string; decision: "approve"; at: string }[] = [];
    let response = errorResponse(task.taskType, "Task did not complete.");
    let outcome: TaskMetrics["outcome"] = "error";
    try {
      const sessions = new InMemorySessions(); // Fresh authentication for every task.
      const taskModels = task.sites.map((site) => {
        const model = models[site];
        if (!model) throw new Error(`Missing model for ${site}.`);
        return { site, model };
      });
      for (const { site, model } of taskModels) {
        const login = config.sites[site].login;
        if (login)
          await deadline.wait(() =>
            loginWithPassword(
              model,
              createExecutorFetch({ model, sessions, fetch: har.transport }),
              login,
            ),
          );
      }
      const initialHistory: PlannerHistory[] = [];
      for (const url of task.start_urls) {
        const model = taskModels.find(
          (m) => siteOrigin(m.model.site) === new URL(url).origin,
        )?.model;
        if (!model) throw new Error("Task starts outside its configured sites.");
        const result = await deadline.wait(() =>
          getPage(model, sessions, har.transport, url, deadline.remaining),
        );
        if (result.status !== "done") throw new Error("Task start page could not be loaded.");
        // Starting-page identity is observed through a real GET. No HTML enters planner context.
        initialHistory.push({
          request: "",
          status: "done",
          observations: await pageFact(har.entries.at(-1)?.request.url ?? url),
        });
      }
      const executor = combineExecutors(
        taskModels.map(({ model }) =>
          createTaskExecutor({
            model,
            sessions,
            fetch: har.transport,
            maxExecutionMs: Math.min(30_000, config.taskTimeoutMs),
          }),
        ),
      );
      const customPlanner = options.plannerFactory?.(task);
      const planner: Planner = {
        async next(input) {
          if (deadline.expired) return { kind: "ask", question: "Task time limit reached." };
          const actual = {
            ...input,
            goal: executor.redact?.(task.intent) ?? task.intent,
            catalogue: `${input.catalogue}\n\n${responseInstructions(task.taskType)}`,
            history: [...initialHistory, ...input.history],
          };
          const estimate = Math.ceil(promptFor(actual).length / 4);
          promptTokens += estimate;
          tokenEstimates.push(estimate);
          // Each CLI can retry once; budget each invocation to half the remaining task time.
          const planner =
            customPlanner ??
            (options.planner === "claude" ? claudeCliPlanner : codexCliPlanner)({
              model: options.model,
              timeoutMs: Math.max(1, Math.floor(deadline.remaining / 2)),
            });
          return deadline.wait(() => planner.next(actual));
        },
      };
      trace = await runTask({
        goal: task.intent,
        model: executor.model,
        executor,
        planner,
        maxSteps: config.maxSteps,
        approver: (approval) => {
          deadline.check();
          approvals.push({
            id: approval.id,
            summary: approval.summary,
            decision: "approve",
            at: new Date().toISOString(),
          });
          return "approve";
        },
      });
      trace.promptTokensEstimate = promptTokens;
      for (const [index, step] of trace.steps.entries())
        step.promptTokensEstimate = tokenEstimates[index] ?? 0;
      outcome = trace.outcome;
      deadline.check();
      response = mapResponse(task.taskType, trace);
      if (task.taskType === "NAVIGATE" && response.status === "SUCCESS") {
        const url = finalPage(trace);
        if (!url)
          response = errorResponse(
            task.taskType,
            "NAVIGATE requires an agent-identified final_url.",
            "DATA_VALIDATION_ERROR",
          );
        else {
          const model = taskModels.find(
            (m) => siteOrigin(m.model.site) === new URL(url).origin,
          )?.model;
          if (!model) throw new Error("Final page is outside the task sites.");
          const result = await deadline.wait(() =>
            getPage(model, sessions, har.transport, url, deadline.remaining),
          );
          if (result.status !== "done")
            response = errorResponse(task.taskType, "Final navigation GET failed.");
        }
      }
    } catch {
      error = deadline.expired
        ? "Task time limit reached."
        : "Task setup, execution or final navigation failed; check learned login and model.";
      outcome = deadline.expired ? "timeout" : "error";
      response = errorResponse(task.taskType, error);
    } finally {
      deadline.close();
    }
    const record: TaskMetrics = {
      taskId: task.task_id,
      sites: task.sites,
      taskType: task.taskType,
      steps: trace?.steps.filter((s) => s.promptTokensEstimate > 0).length ?? tokenEstimates.length,
      promptTokensEstimate: promptTokens,
      wallTimeMs: Math.round(performance.now() - began),
      outcome,
      ...(error ? { error } : {}),
    };
    await writeJson(join(directory, "agent_response.json"), response);
    await writeJson(join(directory, "network.har"), har.har());
    await writeJson(join(directory, "run_config.json"), evaluatorConfig(config));
    await writeJson(join(directory, "metrics.json"), record);
    await writeJson(join(directory, "approvals.json"), approvals);
    if (trace) await writeJson(join(directory, "agent_trace.json"), trace);
    metrics.push(record);
  }
  return metrics;
}
