/**
 * Local deterministic baseline: transparent keyword rules over the sample text. It is a
 * baseline for comparison and a fallback, deliberately low-confidence (every result stays below
 * the thresholds, so the owner is always asked). No network, no model.
 */
import type { PrimaryClass, Sample, UrgencyClass } from "./taxonomy.js";

export interface BaselineResult {
  primary: PrimaryClass;
  primaryRule: string;
  urgency: UrgencyClass;
  urgencyRule: string;
  needsReply: boolean;
  /** Fixed, low: rules like these are guesses. */
  confidence: number;
}

const RULES: { cls: PrimaryClass; rule: string; test: RegExp }[] = [
  {
    cls: "noise",
    rule: "looks like a bulk or promotional message (unsubscribe/newsletter/sale)",
    test: /\b(unsubscribe|newsletter|% off|sale ends|promotion|no-reply|noreply)\b/i,
  },
  {
    cls: "waiting",
    rule: "the sender says they will get back later",
    test: /\b(will get back|get back to you|waiting (on|for)|pending (review|approval)|will follow up)\b/i,
  },
  {
    cls: "action",
    rule: "asks for a task other than a reply (sign, pay, review, submit, book)",
    test: /\b(please (sign|pay|review|submit|complete|book|approve|upload)|action required|invoice|deadline for)\b/i,
  },
  {
    cls: "needs_reply",
    rule: "contains a direct question or request for an answer",
    test: /(\?\s*$|\?\s|\b(can you|could you|would you|let me know|what do you think|are you available)\b)/im,
  },
  {
    cls: "fyi",
    rule: "marked as for information",
    test: /\b(fyi|for your information|just so you know|heads up)\b/i,
  },
];

export function baselineTriage(s: Sample): BaselineResult {
  const text = `${s.subject}\n${s.body}`;
  const hit = RULES.find((r) => r.test.test(text));
  const urgent =
    /\b(urgent|asap|immediately|today|by (tonight|end of day|eod)|within the hour)\b/i.test(text);
  const primary = hit?.cls ?? "read_later";
  return {
    primary,
    primaryRule: hit?.rule ?? "no rule matched (default)",
    urgency: urgent ? "urgent" : "not_urgent",
    urgencyRule: urgent ? "mentions a near deadline or urgency" : "no urgency words",
    needsReply: primary === "needs_reply",
    confidence: hit ? 0.55 : 0.3,
  };
}
