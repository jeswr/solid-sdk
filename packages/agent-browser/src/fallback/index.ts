// AUTHORED-BY Codex GPT-6.1-Sol
import type { ExecuteOptions, ExecutionResult } from "@jeswr/site-executor";
import type { ActionRequest, SiteModel } from "@jeswr/site-model";
import { type CredentialContext, createTaskExecutor } from "../session.js";
import type { Approver, TaskExecutor, TraceStep } from "../types.js";
import { BrowserDriver, BrowserDriverError, type BrowserDriverOptions } from "./driver.js";
import { type LearnFallbackOptions, type LearningResult, learnFallback } from "./learn.js";
import type { FallbackHistory, FallbackPlanner } from "./planner.js";
import { fallbackReceipt } from "./receipt.js";

export {
  BrowserDriver,
  BrowserDriverError,
  type BrowserDriverOptions,
  type DriverClock,
} from "./driver.js";
export { type LearnFallbackOptions, type LearningResult, learnFallback } from "./learn.js";
export {
  type BrowserAction,
  type BrowserSnapshot,
  type FallbackHistory,
  type FallbackPlanner,
  type FallbackPlannerInput,
  type FallbackPlannerOutput,
  type ScriptedFallbackStep,
  scriptedFallbackPlanner,
} from "./planner.js";

export interface FallbackInput {
  goal: string;
  request: ActionRequest;
  model: SiteModel;
  /** Retained if learning or construction fails after a sent write. */
  executor?: TaskExecutor;
  approver: Approver;
  persona?: string;
  maxApprovals: number;
  exclusions: ExecuteOptions;
}
export interface FallbackResult extends LearningResult {
  result: ExecutionResult;
  executor?: TaskExecutor;
  approvals: NonNullable<TraceStep["approvals"]>;
  refreshError?: string;
}
export interface Fallback {
  run(input: FallbackInput): Promise<FallbackResult>;
}
export interface FallbackOptions
  extends Omit<BrowserDriverOptions, "site" | "approver" | "maxApprovals" | "excludeFingerprints"> {
  planner: FallbackPlanner | (() => FallbackPlanner);
  maxSteps?: number;
  transport?: LearnFallbackOptions["transport"];
  labeller?: LearnFallbackOptions["labeller"];
  /** Custom executors must preserve their host configuration when replacing the model. */
  executorFactory?: (
    model: SiteModel,
    credentialContext: CredentialContext,
  ) => TaskExecutor | Promise<TaskExecutor>;
}

/** Opt-in, prompt-free fallback. The host supplies both planners and storage policy. */
export function createFallback(options: FallbackOptions): Fallback {
  const maxSteps = options.maxSteps ?? 20;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0)
    throw new Error("Invalid fallback step bound.");
  return {
    async run(input) {
      const driver = await BrowserDriver.create({
        ...options,
        site: input.model.site,
        cookieContext: { ...options.cookieContext, model: input.model },
        persona: input.persona ?? options.persona,
        approver: input.approver,
        maxApprovals: input.maxApprovals,
        excludeFingerprints: input.exclusions.excludeFingerprints,
      });
      let learning: LearningResult = {
        model: input.model,
        proposed: [],
        rejected: [],
        observations: [],
      };
      let result: ExecutionResult = {
        status: "error",
        committed: [],
        observations: [],
        requests: 0,
      };
      const history: FallbackHistory[] = [];
      let executor = input.executor;
      let browserDone = false;
      try {
        const planner = typeof options.planner === "function" ? options.planner() : options.planner;
        await driver.goto("/");
        let done = false;
        for (let count = 0; count <= maxSteps; count++) {
          const next = await planner.next({
            goal: driver.redact(input.goal),
            request: input.request,
            snapshot: await driver.snapshot(),
            history,
          });
          if (next.kind === "done") {
            done = true;
            browserDone = true;
            break;
          }
          if (next.kind === "give-up")
            throw new BrowserDriverError("browser", "Fallback planner gave up.");
          if (count === maxSteps)
            throw new BrowserDriverError("limit", "Fallback step limit reached.");
          await driver.act(next.action);
          // Fill/type values are always masked. The driver refuses type and every printable/
          // editing press on protected controls before dispatch and before history storage.
          history.push({
            action:
              next.action.kind === "fill" || next.action.kind === "type"
                ? { ...next.action, text: "[redacted]" }
                : next.action.kind === "select"
                  ? { ...next.action, value: "[redacted]" }
                  : next.action.kind === "goto"
                    ? { ...next.action, url: "[same-origin page]" }
                    : { ...next.action },
            status: "done",
          });
        }
        // Finalize evidence, then persist the jar before executor verification.
        await driver.candidates();
        await driver.close();
        if (done) {
          learning = await learnFallback({
            ...options,
            model: input.model,
            request: input.request,
            driver,
            persona: input.persona ?? options.persona,
          });
          // Construct before publishing the new model. Failure retains the prior pair.
          if (learning.proposed.length) {
            if (options.executorFactory)
              executor = await options.executorFactory(learning.model, driver.credentialContext);
            else if (input.executor?.withModel)
              executor = input.executor.withModel(learning.model, driver.credentialContext);
            else if (input.executor)
              throw new Error("Host executor cannot rebuild with a learned model.");
            else
              executor = createTaskExecutor({
                credentialContext: driver.credentialContext,
                model: learning.model,
                cookieContext: { ...options.cookieContext, model: learning.model },
                sessions: options.sessions,
                persona: input.persona ?? options.persona,
                fetch: options.transport,
              });
          } else learning.model = input.model;
          result = {
            ...result,
            status: driver.committed.length || learning.proposed.length ? "done" : "no-path",
            observations: learning.observations,
            ...(driver.committed.length && !learning.proposed.length
              ? {
                  error: "Write completed but was not learned; previous model retained.",
                }
              : {}),
          };
        }
      } catch (error) {
        learning = {
          model: input.model,
          proposed: [],
          observations: [],
          rejected: [
            { candidate: "Fallback learning", reason: "Fallback model was not admitted." },
          ],
        };
        executor = input.executor;
        const completed = browserDone && driver.writesCompleted;
        result = {
          ...result,
          status: completed
            ? "done"
            : error instanceof BrowserDriverError && error.kind === "denied"
              ? "denied"
              : "error",
          error: completed
            ? "Write completed but was not learned; previous model retained."
            : error instanceof BrowserDriverError
              ? error.message
              : "Fallback failed safely.",
          ...(error instanceof BrowserDriverError && error.kind === "repeat"
            ? { errorKind: "repeat" as const }
            : {}),
        };
      } finally {
        try {
          await driver.close();
        } catch {
          result.error = "Fallback cleanup failed safely.";
        }
      }
      result.committed = [...driver.committed];
      result.requests = driver.requests;
      fallbackReceipt(result);
      return {
        ...learning,
        result,
        executor,
        approvals: driver.approvals,
        ...(driver.refreshError ? { refreshError: driver.refreshError } : {}),
      };
    },
  };
}
