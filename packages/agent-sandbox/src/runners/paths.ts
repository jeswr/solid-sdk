// AUTHORED-BY Claude Opus 5.5
/**
 * The bypass check: every action a story wants stopped or held is tried again by each route an
 * agent has to the same systems (a direct tool call, code the agent wrote, an MCP client), and
 * each route must give the same answer. A route that let it through would be a way round the rules.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpProxy } from "../mcp/proxy.js";
import type { EnforcementMode, Outcome, ToolCall } from "../types.js";
import type { Expectation, Scenario } from "../world/scenarios.js";
import { runCode } from "./code.js";
import { applyGrantStep, createWorldSandbox, outcomeOf } from "./story.js";

/** A route from the agent to the systems. */
export type EnforcementPath = "direct" | "code" | "mcp";

export const ENFORCEMENT_PATHS: readonly EnforcementPath[] = ["direct", "code", "mcp"];

/** One refused or held action, tried by every route. */
export interface PathCheck {
  readonly scenario: string;
  readonly step: string;
  readonly call: ToolCall;
  readonly expect: Expectation;
  readonly outcomes: Readonly<Record<EnforcementPath, Outcome>>;
  /** Every route gave the same answer, and none let it through. */
  readonly holds: boolean;
}

/** Replay a story up to (not including) one step, then make that step's call by one route. */
async function attempt(
  scenario: Scenario,
  index: number,
  path: EnforcementPath,
  mode: EnforcementMode,
): Promise<Outcome> {
  const { world, sandbox, clock } = createWorldSandbox(scenario, { mode });
  for (const step of scenario.steps.slice(0, index)) {
    clock.now += 60_000;
    if (step.kind === "call") await sandbox.call(step.call);
    else applyGrantStep(world, step);
  }
  clock.now += 60_000;
  const target = scenario.steps[index];
  if (target?.kind !== "call") throw new Error("not a call step");
  const { tool, args } = target.call;

  if (path === "direct") return outcomeOf(await sandbox.call(target.call));

  if (path === "code") {
    const run = await runCode(
      sandbox,
      `const t = tools[${JSON.stringify(tool)}];
       if (typeof t !== "function") log("not-offered");
       else log((await t(${JSON.stringify(args)})).status);`,
    );
    const status = run.logs[0];
    return status === "done" ? "permit" : status === "held" ? "review" : "stop";
  }

  // An MCP client calls the tool by name whether or not it was listed.
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpProxy(sandbox, { name: "path-check", version: "0.1.0" });
  const client = new Client({ name: "path-check", version: "0.1.0" });
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    const out = await client.callTool({ name: tool, arguments: args as Record<string, unknown> });
    const status = (out.structuredContent as { status?: string } | undefined)?.status;
    return status === "done" ? "permit" : status === "held" ? "review" : "stop";
  } finally {
    await client.close();
  }
}

/** Try every action the stories want stopped or held by every route. */
export async function checkPaths(
  scenarios: readonly Scenario[],
  mode: EnforcementMode = "policy",
): Promise<PathCheck[]> {
  const checks: PathCheck[] = [];
  for (const scenario of scenarios) {
    for (const [index, step] of scenario.steps.entries()) {
      if (step.kind !== "call" || step.expect === "permit") continue;
      const outcomes = {} as Record<EnforcementPath, Outcome>;
      for (const path of ENFORCEMENT_PATHS)
        outcomes[path] = await attempt(scenario, index, path, mode);
      const values = Object.values(outcomes);
      checks.push({
        scenario: scenario.id,
        step: step.note,
        call: step.call,
        expect: step.expect,
        outcomes,
        holds: values.every((o) => o === values[0]) && !values.includes("permit"),
      });
    }
  }
  return checks;
}
