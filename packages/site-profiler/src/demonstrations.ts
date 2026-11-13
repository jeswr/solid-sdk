// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Step 7: demonstrations. A scripted Playwright session stands in for a person showing the agent a
// task once. Its write requests become operations (the only way writes enter a model), and the
// whole session becomes a Flow whose bindings are inferred by matching values: a value sent in a
// later step that appeared on an earlier step's first extracted item binds to that step's
// property; values the demonstrator supplied become flow inputs.

import type { Flow, FlowStep, Operation, Parameter } from "@jeswr/site-model";
import type { BrowserContext } from "playwright";
import { applyExtraction, type Item } from "./extraction.js";
import type { Recorder } from "./recorder.js";
import type { Demonstration, RecordedRequest } from "./types.js";
import { EFFECT_RANK, s, sab, slug } from "./util.js";

/** Run one demonstration in a fresh page and return the requests it made. */
export async function runDemonstration(
  context: BrowserContext,
  recorder: Recorder,
  demo: Demonstration,
): Promise<{ requests: RecordedRequest[]; error?: string }> {
  const startSeq = recorder.trace.length;
  const prevPhase = recorder.phase;
  recorder.phase = "demonstration";
  recorder.demonstration = demo.name;
  const page = await context.newPage();
  let error: string | undefined;
  try {
    await demo.run(page);
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
  } catch (err) {
    error = `demonstration ${demo.name} failed: ${(err as Error).message.split("\n")[0]}`;
  } finally {
    await recorder.flush();
    await page.close();
    recorder.phase = prevPhase;
    recorder.demonstration = undefined;
  }
  const requests = recorder.trace.slice(startSeq).filter((r) => r.demonstration === demo.name);
  return error ? { requests, error } : { requests };
}

/** One request of a demonstration, matched to the operation it exercised. */
export interface DemoStep {
  request: RecordedRequest;
  operation: Operation;
  /** Values the request supplied, by parameter name. */
  values: Record<string, string>;
}

export interface FlowContext {
  modelId: string;
  learnedAt: string;
  derivedFrom: string[];
  usedIds: Set<string>;
}

function lastSegment(v: string): string {
  try {
    const u = new URL(v);
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    return v;
  }
}

function matches(sent: string, seen: string): boolean {
  return sent === seen || (seen.includes("/") && lastSegment(seen) === sent);
}

/** Values too short or generic to say where they came from. */
function trivial(v: string): boolean {
  return v.length < 2 || /^(true|false|null|on|off|yes|no|0|1)$/i.test(v);
}

function humanise(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function flowInputPath(param: Parameter, op: Operation): string[] {
  // The words typed into a search box are the name of the thing the whole flow is about.
  if (op.actionType === s("SearchAction") && param.path.join() === s("query"))
    return [s("object"), s("name")];
  return param.path.length ? param.path : [sab(param.name)];
}

/**
 * Build a Flow from the matched steps of one demonstration. Keeps every write, plus each read whose
 * first extracted item supplies a value a kept step sent.
 */
export function buildFlow(
  demo: Pick<Demonstration, "name" | "description">,
  steps: DemoStep[],
  ctx: FlowContext,
): { flow?: Flow; warnings: string[] } {
  const warnings: string[] = [];
  const firstItems: Array<Item | undefined> = steps.map((st) => {
    const ex = st.operation.extraction;
    const body = st.request.bodySample;
    if (!ex || body === undefined) return undefined;
    return applyExtraction(ex, body, st.request.url)[0];
  });
  const required = new Set<number>();
  steps.forEach((st, i) => {
    if (st.operation.effect !== "read") required.add(i);
  });
  // A demonstrated basket/order total is evidence even when checkout sends no price.
  steps.forEach((st, payment) => {
    if (st.operation.effect !== "payment") return;
    const lastWrite = steps
      .slice(0, payment)
      .findLastIndex((step) => step.operation.effect !== "read");
    steps.forEach((read, i) => {
      if (i <= lastWrite || i >= payment || read.operation.effect !== "read") return;
      const ex = read.operation.extraction;
      if (
        ex &&
        ([s("Order"), s("Invoice")].includes(ex.itemType ?? "") ||
          ex.fields.some((f) => f.property === s("totalPaymentDue")))
      )
        required.add(i);
    });
  });
  if (required.size === 0) {
    warnings.push(`demonstration ${demo.name}: no write requests, so no flow`);
    return { warnings };
  }

  type Source = { step: number; property: string } | { input: Parameter };
  // Where a value came from. A write binds to the latest earlier step showing it (the page the
  // person acted on); a read binds to the earliest (the shortest chain back to the flow inputs).
  // Exact matches win over an IRI whose last path segment equals the value.
  const provider = (v: string, before: number, latest: boolean): Source | undefined => {
    const order = Array.from({ length: before }, (_x, k) => (latest ? before - 1 - k : k));
    for (const exact of [true, false]) {
      for (const j of order) {
        const item = firstItems[j];
        if (!item) continue;
        for (const [property, values] of Object.entries(item)) {
          const first = values[0];
          if (first !== undefined && (exact ? first === v : matches(v, first)))
            return { step: j, property };
        }
      }
    }
    return undefined;
  };
  const sources = new Map<number, Map<string, Source>>();
  const work = [...required].sort((a, b) => b - a);
  const done = new Set<number>();
  while (work.length) {
    const i = work.shift() as number;
    if (done.has(i)) continue;
    done.add(i);
    const st = steps[i] as DemoStep;
    const binds = new Map<string, Source>();
    for (const param of st.operation.inputs) {
      const v = st.values[param.name];
      if (v === undefined || v === "[redacted]") continue;
      let found: Source | undefined;
      if (!trivial(v)) found = provider(v, i, st.operation.effect !== "read");
      if (found && "step" in found) {
        required.add(found.step);
        if (!done.has(found.step)) work.push(found.step);
        work.sort((a, b) => b - a);
      }
      binds.set(param.name, found ?? { input: param });
    }
    sources.set(i, binds);
  }

  const kept = [...required].sort((a, b) => a - b);
  const renumber = new Map(kept.map((old, idx) => [old, idx]));
  const inputs: Parameter[] = [];
  const flowSteps: FlowStep[] = kept.map((old) => {
    const st = steps[old] as DemoStep;
    const bind: Record<string, string> = {};
    for (const [name, src] of sources.get(old) ?? []) {
      if ("step" in src) bind[name] = `$step${renumber.get(src.step)}.${src.property}`;
      else {
        const p = src.input;
        let inputName = p.name;
        const clash = inputs.find((x) => x.name === inputName);
        if (clash && clash.path.join() !== flowInputPath(p, st.operation).join())
          inputName = `${p.name}_${renumber.get(old)}`;
        const shared = inputs.find((x) => x.name === inputName);
        if (shared) {
          // A retained total read can introduce this input before the payment form does.
          // Carry the form's default/options to their shared input so both requests agree.
          if (shared.default === undefined && p.default !== undefined) {
            shared.default = p.default;
            shared.required = false;
          }
          if (!shared.options && p.options) shared.options = p.options;
        } else {
          const value = st.values[name] as string;
          const input: Parameter = {
            name: inputName,
            path: flowInputPath(p, st.operation),
            range: p.range,
            required: p.default === undefined && p.required,
            location: p.location,
            example: value,
          };
          if (p.description) input.description = p.description;
          if (p.options) input.options = p.options;
          if (p.default !== undefined) input.default = p.default;
          inputs.push(input);
        }
        bind[name] = `$input.${inputName}`;
      }
    }
    for (const param of st.operation.inputs) {
      if (param.required && bind[param.name] === undefined && param.default === undefined) {
        warnings.push(
          `demonstration ${demo.name}: step ${renumber.get(old)} has no value for ${param.name}`,
        );
      }
    }
    return { operation: st.operation.id, bind };
  });

  const keptOps = kept.map((i) => (steps[i] as DemoStep).operation);
  const effect = keptOps.reduce(
    (max, op) => ((EFFECT_RANK[op.effect] ?? 0) > (EFFECT_RANK[max] ?? 0) ? op.effect : max),
    "read" as Flow["effect"],
  );
  const lastWrite = [...keptOps].reverse().find((op) => op.effect !== "read") as Operation;
  const actionType = effect === "payment" ? s("BuyAction") : lastWrite.actionType;
  let id = `${ctx.modelId}#flow-${slug(demo.name)}`;
  for (let n = 2; ctx.usedIds.has(id); n++) id = `${ctx.modelId}#flow-${slug(demo.name)}-${n}`;
  ctx.usedIds.add(id);
  const flow: Flow = {
    id,
    actionType,
    label: humanise(demo.name),
    inputs,
    steps: flowSteps,
    effect,
    provenance: {
      derivedFrom: ctx.derivedFrom,
      learnedAt: ctx.learnedAt,
      method: "demonstration",
      confidence: 0.8,
    },
  };
  if (demo.description) flow.description = demo.description;
  return { flow, warnings };
}
