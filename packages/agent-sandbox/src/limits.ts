// AUTHORED-BY Claude Opus 5.5
// Send and spend limits from the mandate's `agent:` limit vocabulary (fixed by agent-mandate;
// interpreted with the same windows as agent-executor: UTC calendar day/week/month for global
// counts and spend, a rolling 24 hours for contacts with one person).
import { AGENT, type Limit } from "@jeswr/agent-mandate";
import type { Amount } from "./types.js";

/** One committed effect, recorded when a send or payment actually runs. */
export interface Commitment {
  readonly at: number;
  readonly kind: "send" | "pay";
  /** One commitment per recipient: a message to three people is three sends. */
  readonly recipient: string;
  readonly amount?: Amount;
}

/** The candidate effect being checked. */
export interface Candidate {
  readonly kind: "send" | "pay";
  readonly recipients: readonly string[];
  readonly amount?: Amount;
}

/** A limit that a candidate would break. */
export interface LimitBreach {
  readonly operand: string;
  readonly enforcement: "hard" | "soft";
  readonly used: number;
  readonly limit: number;
  readonly recipient?: string;
}

const DAY = 86_400_000;

/** Start of the UTC day, ISO week (Monday) or month containing `at`. */
export function periodStart(at: number, period: "day" | "week" | "month"): number {
  const d = new Date(at);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (period === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === "month") start.setUTCDate(1);
  return start.getTime();
}

/**
 * Check a candidate against every limit. Unknown limit operands, non-`lteq` operators,
 * negative or non-finite bounds and currency mismatches are breaches (fail closed).
 */
export function checkLimits(
  limits: readonly Limit[],
  currency: string,
  history: readonly Commitment[],
  candidate: Candidate,
  now: number,
): LimitBreach[] {
  const breaches: LimitBreach[] = [];
  for (const limit of limits) {
    const operand = limit.leftOperand.startsWith(AGENT)
      ? limit.leftOperand.slice(AGENT.length)
      : "";
    const bound = limit.rightOperand;
    const broken = (used: number, recipient?: string) =>
      breaches.push({
        operand: operand || limit.leftOperand,
        enforcement: limit.enforcement === "soft" ? "soft" : "hard",
        used,
        limit: bound,
        ...(recipient !== undefined && { recipient }),
      });
    if (limit.operator !== "lteq" || !Number.isFinite(bound) || bound < 0) {
      broken(Number.NaN);
      continue;
    }
    switch (operand) {
      case "sendsPerDay": {
        if (candidate.kind !== "send") break;
        const start = periodStart(now, "day");
        const used = history.filter((c) => c.kind === "send" && c.at >= start).length;
        if (used + candidate.recipients.length > bound) broken(used);
        break;
      }
      case "perRecipientPerDay": {
        if (candidate.kind !== "send") break;
        for (const recipient of candidate.recipients) {
          const used = history.filter(
            (c) => c.kind === "send" && c.recipient === recipient && c.at > now - DAY,
          ).length;
          if (used + 1 > bound) broken(used, recipient);
        }
        break;
      }
      case "spendPerDay":
      case "spendPerWeek":
      case "spendPerMonth": {
        if (candidate.kind !== "pay") break;
        const amount = candidate.amount;
        if (
          !amount ||
          amount.currency !== currency ||
          !Number.isFinite(amount.value) ||
          amount.value < 0
        ) {
          broken(Number.NaN);
          break;
        }
        const period =
          operand === "spendPerDay" ? "day" : operand === "spendPerWeek" ? "week" : "month";
        const start = periodStart(now, period);
        const used = history
          .filter((c) => c.kind === "pay" && c.at >= start && c.amount?.currency === currency)
          .reduce((sum, c) => sum + (c.amount?.value ?? 0), 0);
        // Pence, to keep 0.1 + 0.2 style float error out of the comparison.
        if (Math.round((used + amount.value) * 100) > Math.round(bound * 100)) broken(used);
        break;
      }
      default:
        broken(Number.NaN);
    }
  }
  return breaches;
}
