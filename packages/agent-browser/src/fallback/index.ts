// AUTHORED-BY Codex GPT-6.1-Sol
import type { ExecuteOptions, ExecutionResult } from "@jeswr/site-executor";
import { type ActionRequest, SAB, type SiteModel } from "@jeswr/site-model";
import { DataFactory } from "n3";
import { writeQuads } from "../rdf.js";
import { createTaskExecutor } from "../session.js";
import type { Approver, TaskExecutor, TraceStep } from "../types.js";
import { BrowserDriver, BrowserDriverError, type BrowserDriverOptions } from "./driver.js";
import { type LearnFallbackOptions, type LearningResult, learnFallback } from "./learn.js";
import type { FallbackHistory, FallbackPlanner } from "./planner.js";

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
  approver: Approver;
  persona?: string;
  maxApprovals: number;
  exclusions: ExecuteOptions;
}
export interface FallbackResult extends LearningResult {
  result: ExecutionResult;
  executor: TaskExecutor;
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
}

function receipt(result: ExecutionResult): void {
  if (!result.committed.length) return;
  const { namedNode, blankNode, literal, quad } = DataFactory;
  const node = blankNode();
  const status = result.status === "done" ? "completed" : "uncertain";
  const label = result.committed.at(-1)?.target.label ?? "Fallback write";
  result.outcome = { status, target: label, effect: "irreversible-write" };
  result.observations.unshift({
    operation: "urn:sab:fallback:receipt",
    status: 200,
    itemCount: 0,
    turtle: writeQuads([
      quad(
        node,
        namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        namedNode(`${SAB}ActionOutcome`),
      ),
      quad(
        node,
        namedNode(`${SAB}status`),
        namedNode(`${SAB}${status === "completed" ? "Completed" : "Uncertain"}`),
      ),
      quad(node, namedNode(`${SAB}target`), literal(label)),
      quad(node, namedNode(`${SAB}effect`), namedNode(`${SAB}IrreversibleWrite`)),
    ]),
  });
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
      const planner = typeof options.planner === "function" ? options.planner() : options.planner;
      try {
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
            break;
          }
          if (next.kind === "give-up")
            throw new BrowserDriverError("browser", "Fallback planner gave up.");
          if (count === maxSteps)
            throw new BrowserDriverError("limit", "Fallback step limit reached.");
          await driver.act(next.action);
          // Values never return to either planner's history.
          history.push({
            action:
              next.action.kind === "fill"
                ? { ...next.action, text: "[redacted]" }
                : next.action.kind === "select"
                  ? { ...next.action, value: "[redacted]" }
                  : next.action.kind === "goto"
                    ? { ...next.action, url: "[same-origin page]" }
                    : next.action,
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
          result = {
            ...result,
            status: driver.committed.length || learning.proposed.length ? "done" : "no-path",
            observations: learning.observations,
          };
        }
      } catch (error) {
        result = {
          ...result,
          status:
            error instanceof BrowserDriverError && error.kind === "denied" ? "denied" : "error",
          error: error instanceof BrowserDriverError ? error.message : "Fallback failed safely.",
          ...(error instanceof BrowserDriverError && error.kind === "repeat"
            ? { errorKind: "repeat" as const }
            : {}),
        };
      } finally {
        await driver.close();
      }
      result.committed = [...driver.committed];
      result.requests = driver.requests;
      receipt(result);
      const executor = createTaskExecutor({
        model: learning.model,
        sessions: options.sessions,
        persona: input.persona ?? options.persona,
        fetch: options.transport,
      });
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
