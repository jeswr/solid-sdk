// AUTHORED-BY Codex GPT-6

import { canonicalJson } from "../core/canonical.js";
import { LAYER_FEEDS } from "../suites/feeds.js";
import type { LayerId } from "../suites/registry.js";
import type { TraceFile } from "../trace/types.js";

/** Filtering only fed checks lets those checks gain or lose verdicts without hiding other shifts. */
export function confinementDifferences(
  baseline: TraceFile,
  alternative: TraceFile,
  layer: LayerId,
): string[] {
  const fed = LAYER_FEEDS[layer];
  const rows = (trace: TraceFile) =>
    trace.events
      .filter((event) => event.kind === "check" && event.check && !fed.includes(event.check))
      .map((event) => ({
        agent: event.agent,
        gate: event.part,
        check: event.check,
        verdict: event.verdict,
        reason: event.reason ?? null,
      }));
  const before = rows(baseline),
    after = rows(alternative),
    differences: string[] = [];
  for (let index = 0; index < Math.max(before.length, after.length); index++) {
    if (canonicalJson(before[index] ?? null) !== canonicalJson(after[index] ?? null))
      differences.push(
        `Check ${index + 1}: baseline ${JSON.stringify(before[index] ?? "missing")}; alternative ${JSON.stringify(after[index] ?? "missing")}`,
      );
  }
  const final = (trace: TraceFile) => {
    const decision = trace.events.findLast((event) => event.kind === "decision");
    const message = trace.events.findLast(
      (event) =>
        event.kind === "message-in" &&
        ["receipt", "refuse", "unsupported", "indeterminate"].includes(event.packet?.kind ?? ""),
    );
    const body = message?.packet?.layers.content.raw as
      | {
          outcome?: string;
          reason?: string;
          final?: boolean;
          observed?: { stage?: string; decided?: { status?: string } };
        }
      | undefined;
    return {
      gate: decision
        ? { agent: decision.agent, gate: decision.part, outcome: decision.outcome }
        : null,
      journey: message
        ? {
            agent: message.agent,
            kind: message.packet?.kind,
            outcome: body?.outcome ?? body?.reason ?? null,
            final: body?.final ?? null,
            stage: body?.observed?.stage ?? null,
            decision: body?.observed?.decided?.status ?? null,
          }
        : null,
    };
  };
  if (canonicalJson(final(baseline)) !== canonicalJson(final(alternative)))
    differences.push(
      `Final outcome: baseline ${JSON.stringify(final(baseline))}; alternative ${JSON.stringify(final(alternative))}`,
    );
  return differences;
}
