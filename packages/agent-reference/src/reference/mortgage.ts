// AUTHORED-BY Codex GPT-6
/** Compatibility entry points; the five reference journeys execute profile/scenario data. */
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
import type { Iri } from "../core/types.js";
import { CLAIM, PREQUAL_OP, VALUATION_OP } from "../domains/mortgage.js";
import { PAYMENT_OP } from "../domains/scheduling.js";
import { loadCase } from "../engine/load.js";
import { runScenario } from "../engine/run.js";
import { NORTH, SAM, VALUER } from "../fixtures/mortgage.js";
import type { PrincipalLimits } from "../gates/common.js";
import { AWP } from "../profile/vocabulary.js";
import type { AgentRuntime, OutboundMessage } from "../runtime/agent.js";
import { BASELINE } from "../suites/baseline.js";
import type { Configuration } from "../suites/registry.js";
import type { TraceRecorder } from "../trace/recorder.js";
import type { TraceAgent, TraceFile } from "../trace/types.js";
import { HARBOUR, PAYWELL } from "./fixtures.js";
import { BALANCE_OP, HARBOUR_AGENT, IDP, INDEX, PRODUCT_SEARCH_OP } from "./main-fixtures.js";

/** The logical clock: every run starts at the same instant and only the driver moves it. */
export const REFERENCE_START = "2026-11-13T09:00:00.000Z";

export const SCENARIOS = {
  "mortgage-core": "Sam's mortgage in principle, core flow (no index, no step-up)",
  "mortgage-over-ask": "The lender asks for more than Sam's mandate allows",
  "mortgage-out-of-limit": "The lender's terms are outside Sam's limits",
  "mortgage-injected-fee": "A message carries an instruction to pay a fee",
  "mortgage-main":
    "Sam's mortgage in principle, all 14 steps: the product index, the register chain and a stronger approval at his bank",
} as const;
export type ScenarioId = keyof typeof SCENARIOS;

export const NAMES: Record<string, string> = {
  [INDEX.party]: "the mortgage product index",
  [INDEX.actor]: "the index's agent",
  [HARBOUR_AGENT.actor]: "Harbour Bank's agent",
  [IDP]: "the identity provider",
  [SAM.party]: "Sam",
  [SAM.actor]: "Sam's agent",
  [NORTH.party]: "North Bank",
  [NORTH.actor]: "North Bank's agent",
  [PAYWELL]: "Paywell",
  [HARBOUR]: "Harbour Bank",
  [VALUER]: "the valuer",
  "https://underwriter.example/#org": "the underwriter",
  [`${AWP}fixture/national-trust-root`]: "National trust root",
};
export const name = (iri: string | undefined): string =>
  iri ? (NAMES[iri] ?? iri) : "an anonymous asker";

const TASKS: Record<string, string> = {
  [PREQUAL_OP.id]: "a mortgage application",
  [VALUATION_OP.id]: "a valuation order",
  [PAYMENT_OP]: "a payment",
  [PRODUCT_SEARCH_OP.id]: "a product search",
  [BALANCE_OP.id]: "a request for your balance statement",
};
export const taskLabel = (op: Iri) => TASKS[op] ?? op;

export const TRACE_AGENTS: readonly TraceAgent[] = [
  { id: "sams-agent", name: "Sam's agent", actsFor: "sam", role: "Personal agent" },
  { id: "lender", name: "North Bank", actsFor: "lender", role: "Lender" },
];

/** Sam's limits on top of his mandate (the gate enforces these, not the core). */
export const SAM_LIMITS: PrincipalLimits = {
  id: `${AWP}limits/sam/retention`,
  maxRetentionDays: 60,
};

interface Run {
  readonly recorder: TraceRecorder;
  readonly sam: { runtime: AgentRuntime; ledger: { entries(): readonly never[] } };
}

/** Deliver queued messages one at a time, labelling each delivery with a step. */
export async function deliver(
  recorder: TraceRecorder,
  byActor: Map<Iri, AgentRuntime>,
  queue: Array<{ out: OutboundMessage }>,
  stepOf: (out: OutboundMessage) => number | undefined,
  before?: (out: OutboundMessage) => Promise<void>,
  /** Where a reply to an anonymous asker goes: back on the asker's own connection. */
  anonymousAsker?: AgentRuntime,
): Promise<void> {
  let guard = 0;
  while (queue.length > 0 && guard++ < 100) {
    const item = queue.shift() as { out: OutboundMessage };
    const to = item.out.toActor ? byActor.get(item.out.toActor) : anonymousAsker;
    if (!to) continue;
    await before?.(item.out);
    const step = stepOf(item.out);
    if (step !== undefined) recorder.step(step);
    const result = await to.receive(JSON.parse(JSON.stringify(item.out.wire)), {
      binding: "direct-local/0.1",
    });
    for (const out of result.outbound) queue.push({ out });
  }
}

/** The worked-example step a delivery belongs to; closing messages keep the current step. */
export function stepOf(out: OutboundMessage): number | undefined {
  const m = out.message;
  if (m.kind === "describe" || m.kind === "description") return 4;
  if (m.kind === "propose") return (m.body as { round?: number }).round === 1 ? 5 : 11;
  if (m.kind === "accept") return 12;
  if (m.kind === "deliver")
    return m.from.actor === NORTH.actor && m.body.operation.id === PREQUAL_OP.id ? 13 : 12;
  if (m.kind === "receipt") return (m.body as { final?: boolean }).final ? 13 : 12;
  return undefined;
}

/** Titles of the worked-example steps, in plain words. */
export const STEP_TITLES: Readonly<Record<number, string>> = {
  1: "Sam signs a mandate",
  2: "Sam asks for a mortgage in principle",
  3: "Sam's agent looks North Bank up before contacting it",
  4: "The agents describe themselves and Sam's agent applies",
  5: "North Bank says what evidence it needs",
  6: "Sam's agent asks Harbour Bank for a signed balance statement",
  7: "Harbour Bank asks for a stronger approval",
  8: "Sam does a face check and the request is sent again",
  9: "Harbour Bank returns a signed statement with its terms",
  10: "Sam's agent checks the statements it holds",
  11: "Sam is asked, and the agent shares the evidence",
  12: "North Bank's gate checks the evidence",
  13: "North Bank returns a signed decision in principle",
  14: "Each side checks its own record",
};

export function stepsIn(
  recorder: TraceRecorder,
  titles: Readonly<Record<number, string>> = STEP_TITLES,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of recorder.events()) {
    const title = titles[e.step];
    if (title) out[String(e.step)] = title;
  }
  return out;
}

/** Run through the data engine and compare against the maintained complete outline. */
export async function runReference(
  scenario: ScenarioId,
  opts: { commit?: string; configuration?: Configuration } = {},
): Promise<TraceFile> {
  if (
    opts.configuration &&
    JSON.stringify(opts.configuration.layers) !== JSON.stringify(BASELINE.layers)
  )
    throw new Error("the mortgage data profiles require the baseline configuration");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const data = loadCase(root, scenario);
  const [path] = await runScenario(data.profile, data.scenario, { commit: opts.commit });
  if (!path?.trace || !path.matches)
    throw new Error(`mortgage data path ${scenario} did not reproduce its complete outline`);
  return path.trace;
}
export type { Run };
export { CLAIM };
